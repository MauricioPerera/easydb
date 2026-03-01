/**
 * EasyDB SyncEngine — Cross-adapter database synchronization
 *
 * Synchronizes data between two EasyDB instances backed by different adapters.
 * Supports push, pull, and bidirectional modes with configurable conflict resolution.
 *
 * Usage:
 *
 *   import EasyDB from '@rckflr/easydb';
 *   import { SyncEngine } from '@rckflr/easydb/sync';
 *
 *   const local = await EasyDB.open('app', { adapter: idbAdapter, schema });
 *   const remote = await EasyDB.open('app', { adapter: pgAdapter, schema });
 *
 *   const sync = new SyncEngine(local, remote, {
 *     stores: ['users', 'orders'],
 *     direction: 'bidirectional',
 *     conflict: 'last-write-wins',
 *   });
 *
 *   sync.start();
 *   // ... later
 *   sync.stop();
 *
 * @license MIT
 */

// ── SyncEngine ──────────────────────────────────────────

export class SyncEngine {
  /**
   * @param {import('./easydb.js').EasyDB} source - Source database
   * @param {import('./easydb.js').EasyDB} target - Target database
   * @param {object} opts
   * @param {string[]} opts.stores - Store names to sync
   * @param {'push'|'pull'|'bidirectional'} [opts.direction='push']
   * @param {'last-write-wins'|'source-wins'|'target-wins'|'manual'} [opts.conflict='source-wins']
   * @param {function} [opts.onConflict] - Manual conflict resolver (store, key, sourceVal, targetVal) => resolvedVal
   * @param {number} [opts.pullInterval=30000] - Polling interval for pull (ms)
   * @param {function} [opts.onError] - Error handler (err, context) => void
   * @param {function} [opts.onSync] - Callback after each sync event (event) => void
   * @param {string} [opts.timestampField='_syncedAt'] - Field used for last-write-wins
   */
  constructor(source, target, opts = {}) {
    this._source = source;
    this._target = target;
    this._stores = opts.stores || [];
    this._direction = opts.direction || 'push';
    this._conflict = opts.conflict || 'source-wins';
    this._onConflict = opts.onConflict || null;
    this._pullInterval = opts.pullInterval ?? 30000;
    this._onError = opts.onError || null;
    this._onSync = opts.onSync || null;
    this._tsField = opts.timestampField || '_syncedAt';

    this._running = false;
    this._watchers = [];      // watch iterator cleanup functions
    this._pullTimers = [];    // pull interval IDs
    this._paused = false;
    this._pendingQueue = [];  // events queued while paused
    this._syncing = false;    // re-entrancy guard for bidirectional
  }

  /** Whether the sync engine is currently running. */
  get running() { return this._running; }

  /** Whether the sync engine is paused. */
  get paused() { return this._paused; }

  /**
   * Start synchronization.
   * - push: watches source, replicates to target
   * - pull: polls target, replicates to source
   * - bidirectional: both push and pull
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;

    if (this._direction === 'push' || this._direction === 'bidirectional') {
      this._startPush(this._source, this._target);
    }

    if (this._direction === 'pull' || this._direction === 'bidirectional') {
      this._startPull(this._target, this._source);
    }

    // Bidirectional: also watch target → source
    if (this._direction === 'bidirectional') {
      this._startPush(this._target, this._source);
    }
  }

  /** Stop all synchronization. */
  stop() {
    this._running = false;
    this._paused = false;
    this._pendingQueue.length = 0;

    for (const cleanup of this._watchers) cleanup();
    this._watchers.length = 0;

    for (const timer of this._pullTimers) clearInterval(timer);
    this._pullTimers.length = 0;
  }

  /** Pause sync — events are queued but not applied. */
  pause() {
    if (!this._running) return;
    this._paused = true;
  }

  /** Resume sync — flush queued events. */
  async resume() {
    if (!this._running || !this._paused) return;
    this._paused = false;

    // Flush pending events
    const pending = this._pendingQueue.splice(0);
    for (const { from, to, storeName, event } of pending) {
      await this._applyEvent(from, to, storeName, event);
    }
  }

  /**
   * Perform a one-time full sync of all configured stores.
   * Compares both sides and reconciles using the configured conflict strategy.
   */
  async syncAll() {
    for (const storeName of this._stores) {
      await this._syncStore(storeName);
    }
  }

  /**
   * Perform a one-time full sync of a single store.
   */
  async syncStore(storeName) {
    await this._syncStore(storeName);
  }

  // ── Push (watch-based) ──────────────────────────────────

  _startPush(from, to) {
    for (const storeName of this._stores) {
      const watcher = from[storeName].watch();
      const iter = watcher[Symbol.asyncIterator]();
      let stopped = false;

      const consume = async () => {
        try {
          while (!stopped) {
            const { value: event, done } = await iter.next();
            if (done || stopped) break;

            if (this._paused) {
              this._pendingQueue.push({ from, to, storeName, event });
              continue;
            }

            await this._applyEvent(from, to, storeName, event);
          }
        } catch (err) {
          if (stopped) return;
          this._handleError(err, { op: 'push', store: storeName });
        }
      };

      consume();

      this._watchers.push(() => {
        stopped = true;
        iter.return();
      });
    }
  }

  // ── Pull (polling-based) ────────────────────────────────

  _startPull(from, to) {
    // Track what we've seen per store (snapshot of keys + values)
    const snapshots = new Map();

    const doPull = async () => {
      for (const storeName of this._stores) {
        if (!this._running || this._paused) return;

        try {
          const keyPath = from._conn.getKeyPath(storeName);
          if (!keyPath) continue;

          const fromAll = await from[storeName].getAll();
          const toAll = await to[storeName].getAll();

          const fromMap = new Map(fromAll.map(v => [v[keyPath], v]));
          const toMap = new Map(toAll.map(v => [v[keyPath], v]));

          const prev = snapshots.get(storeName) || new Map();

          // Batch: detect new/updated in `from`
          const toPut = [];
          for (const [key, val] of fromMap) {
            const existing = toMap.get(key);
            const prevVal = prev.get(key);

            // Skip if identical to what we saw last time (no change)
            if (prevVal && JSON.stringify(prevVal) === JSON.stringify(val)) continue;

            if (!existing) {
              toPut.push(val);
              this._emitSync({ op: 'pull', store: storeName, type: 'put', key });
            } else if (JSON.stringify(existing) !== JSON.stringify(val)) {
              // Conflict: exists in both but different
              const resolved = await this._resolveConflict(storeName, key, val, existing);
              if (resolved !== undefined) {
                toPut.push(resolved);
                this._emitSync({ op: 'pull', store: storeName, type: 'put', key, conflict: true });
              }
            }
          }

          if (toPut.length) await to[storeName].putMany(toPut);

          // Detect deletions: was in prev snapshot but not in current from
          for (const [key] of prev) {
            if (!fromMap.has(key) && toMap.has(key)) {
              await to[storeName].delete(key);
              this._emitSync({ op: 'pull', store: storeName, type: 'delete', key });
            }
          }

          // Update snapshot
          snapshots.set(storeName, fromMap);
        } catch (err) {
          this._handleError(err, { op: 'pull', store: storeName });
        }
      }
    };

    // Initial pull
    doPull();

    // Periodic pull
    const timer = setInterval(doPull, this._pullInterval);
    this._pullTimers.push(timer);
  }

  // ── Sync all (snapshot + diff) ──────────────────────────

  async _syncStore(storeName) {
    const sourceKeyPath = this._source._conn.getKeyPath(storeName);
    const targetKeyPath = this._target._conn.getKeyPath(storeName);
    const keyPath = sourceKeyPath || targetKeyPath;
    if (!keyPath) return;

    const sourceAll = await this._source[storeName].getAll();
    const targetAll = await this._target[storeName].getAll();

    const sourceMap = new Map(sourceAll.map(v => [v[keyPath], v]));
    const targetMap = new Map(targetAll.map(v => [v[keyPath], v]));

    // Batch: records to push to target
    const toTarget = [];
    const toSourceFromConflict = [];

    for (const [key, val] of sourceMap) {
      const existing = targetMap.get(key);
      if (!existing) {
        toTarget.push(val);
        this._emitSync({ op: 'syncAll', store: storeName, type: 'put', key, direction: 'source→target' });
      } else if (JSON.stringify(existing) !== JSON.stringify(val)) {
        const resolved = await this._resolveConflict(storeName, key, val, existing);
        if (resolved !== undefined) {
          toTarget.push(resolved);
          if (this._direction === 'bidirectional') {
            toSourceFromConflict.push(resolved);
          }
          this._emitSync({ op: 'syncAll', store: storeName, type: 'put', key, conflict: true });
        }
      }
    }

    if (toTarget.length) await this._target[storeName].putMany(toTarget);
    if (toSourceFromConflict.length) await this._source[storeName].putMany(toSourceFromConflict);

    // Batch: records only in target → pull to source (if bidirectional)
    if (this._direction === 'bidirectional' || this._direction === 'pull') {
      const toSource = [];
      for (const [key, val] of targetMap) {
        if (!sourceMap.has(key)) {
          toSource.push(val);
          this._emitSync({ op: 'syncAll', store: storeName, type: 'put', key, direction: 'target→source' });
        }
      }
      if (toSource.length) await this._source[storeName].putMany(toSource);
    }
  }

  // ── Apply a single watch event ──────────────────────────

  async _applyEvent(from, to, storeName, event) {
    // Re-entrancy guard: skip if we're already applying a sync event
    // (prevents infinite loops in bidirectional mode)
    if (this._syncing) return;
    this._syncing = true;

    try {
      const keyPath = from._conn.getKeyPath(storeName);

      if (event.type === 'put' && event.value != null) {
        const key = keyPath ? event.value[keyPath] : event.key;
        const existing = await to[storeName].get(key);

        if (existing && JSON.stringify(existing) !== JSON.stringify(event.value)) {
          // Conflict
          const resolved = await this._resolveConflict(storeName, key, event.value, existing);
          if (resolved !== undefined) {
            await to[storeName].put(resolved);
            this._emitSync({ op: 'push', store: storeName, type: 'put', key, conflict: true });
          }
        } else {
          await to[storeName].put(event.value);
          this._emitSync({ op: 'push', store: storeName, type: 'put', key });
        }
      } else if (event.type === 'delete') {
        await to[storeName].delete(event.key);
        this._emitSync({ op: 'push', store: storeName, type: 'delete', key: event.key });
      } else if (event.type === 'clear') {
        await to[storeName].clear();
        this._emitSync({ op: 'push', store: storeName, type: 'clear' });
      }
    } catch (err) {
      this._handleError(err, { op: 'applyEvent', store: storeName, event });
    } finally {
      this._syncing = false;
    }
  }

  // ── Conflict resolution ─────────────────────────────────

  async _resolveConflict(storeName, key, sourceVal, targetVal) {
    switch (this._conflict) {
      case 'source-wins':
        return sourceVal;

      case 'target-wins':
        return targetVal;

      case 'last-write-wins': {
        const tsField = this._tsField;
        const sourceTs = sourceVal[tsField] || 0;
        const targetTs = targetVal[tsField] || 0;
        return sourceTs >= targetTs ? sourceVal : targetVal;
      }

      case 'manual':
        if (this._onConflict) {
          return this._onConflict(storeName, key, sourceVal, targetVal);
        }
        // Fallback to source-wins if no handler
        return sourceVal;

      default:
        return sourceVal;
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  _handleError(err, context) {
    if (this._onError) {
      this._onError(err, context);
    }
  }

  _emitSync(event) {
    if (this._onSync) {
      this._onSync(event);
    }
  }
}
