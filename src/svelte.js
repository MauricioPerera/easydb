/**
 * Svelte integration for EasyDB
 *
 * Provides readable stores that auto-update when data changes.
 *
 * Usage:
 *   import { queryStore, recordStore } from '@rckflr/easydb/svelte';
 *
 *   const admins = queryStore(db.users.where('role', 'admin'));
 *   // In template: {#each $admins.data as user}...{/each}
 *
 * Works with Svelte 3/4/5. Uses the Svelte store contract (subscribe).
 */

/**
 * Creates a Svelte readable store from an EasyDB query.
 *
 * @param {QueryBuilder|StoreAccessor} queryOrStore
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when data changes
 * @returns {{ subscribe: Function, refresh: Function }}
 */
export function queryStore(queryOrStore, opts = {}) {
  const watchEnabled = opts.watch !== false;

  // Detect StoreAccessor vs QueryBuilder
  const isStore = queryOrStore && typeof queryOrStore.all === 'function'
    && typeof queryOrStore.watch === 'function'
    && typeof queryOrStore.put === 'function';
  const query = isStore ? queryOrStore.all() : queryOrStore;
  const store = isStore ? queryOrStore : null;

  let state = { data: [], loading: true, error: null };
  const subscribers = new Set();

  function set(newState) {
    state = newState;
    for (const cb of subscribers) cb(state);
  }

  function refresh() {
    set({ ...state, loading: true, error: null });
    query.toArray()
      .then(results => set({ data: results, loading: false, error: null }))
      .catch(err => set({ data: state.data, loading: false, error: err }));
  }

  // Initial fetch
  refresh();

  // Watch setup
  let watcherCleanup = null;

  function setupWatcher() {
    if (!watchEnabled || !store) return;

    const watcher = store.watch()[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      try {
        while (!cancelled) {
          const { done } = await watcher.next();
          if (done || cancelled) break;
          refresh();
        }
      } catch (err) {
        if (!cancelled) set({ data: state.data, loading: false, error: err });
      }
    })();

    watcherCleanup = () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }

  return {
    subscribe(cb) {
      subscribers.add(cb);
      cb(state);

      // Start watching when first subscriber arrives
      if (subscribers.size === 1) setupWatcher();

      return () => {
        subscribers.delete(cb);
        // Cleanup watcher when last subscriber leaves
        if (subscribers.size === 0 && watcherCleanup) {
          watcherCleanup();
          watcherCleanup = null;
        }
      };
    },
    refresh,
  };
}

/**
 * Creates a Svelte readable store that tracks SyncEngine status.
 *
 * @param {import('./sync.js').SyncEngine} syncEngine
 * @returns {{ subscribe: Function }} - { running, paused, lastEvent, error }
 */
export function syncStatusStore(syncEngine) {
  let state = { running: syncEngine.running, paused: syncEngine.paused, lastEvent: null, error: null };
  const subscribers = new Set();
  let unsubscribe = null;

  function set(newState) {
    state = newState;
    for (const cb of subscribers) cb(state);
  }

  return {
    subscribe(cb) {
      subscribers.add(cb);
      cb(state);

      if (subscribers.size === 1) {
        unsubscribe = syncEngine.addListener({
          onSync(event) {
            set({ ...state, lastEvent: event });
          },
          onError(err, context) {
            set({ ...state, error: { err, context } });
          },
          onStatusChange(status) {
            set({ ...state, running: status.running, paused: status.paused });
          },
        });
      }

      return () => {
        subscribers.delete(cb);
        if (subscribers.size === 0 && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
  };
}

/**
 * Creates a Svelte readable store for a single record by key.
 *
 * @param {StoreAccessor} store
 * @param {any} key
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when the record changes
 * @returns {{ subscribe: Function, refresh: Function }}
 */
export function recordStore(store, key, opts = {}) {
  const watchEnabled = opts.watch !== false;

  let state = { data: undefined, loading: true, error: null };
  const subscribers = new Set();

  function set(newState) {
    state = newState;
    for (const cb of subscribers) cb(state);
  }

  function refresh() {
    set({ ...state, loading: true, error: null });
    store.get(key)
      .then(result => set({ data: result, loading: false, error: null }))
      .catch(err => set({ data: state.data, loading: false, error: err }));
  }

  // Initial fetch
  refresh();

  let watcherCleanup = null;

  function setupWatcher() {
    if (!watchEnabled) return;

    const watcher = store.watch({ key })[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      try {
        while (!cancelled) {
          const { done } = await watcher.next();
          if (done || cancelled) break;
          refresh();
        }
      } catch (err) {
        if (!cancelled) set({ data: state.data, loading: false, error: err });
      }
    })();

    watcherCleanup = () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }

  return {
    subscribe(cb) {
      subscribers.add(cb);
      cb(state);

      if (subscribers.size === 1) setupWatcher();

      return () => {
        subscribers.delete(cb);
        if (subscribers.size === 0 && watcherCleanup) {
          watcherCleanup();
          watcherCleanup = null;
        }
      };
    },
    refresh,
  };
}
