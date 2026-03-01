/**
 * Lit integration for EasyDB
 *
 * Provides EasyDBQueryController and EasyDBRecordController as
 * Lit ReactiveControllers for declarative data fetching.
 *
 * Usage:
 *   import { EasyDBQueryController } from '@rckflr/easydb/lit';
 *
 *   class AdminList extends LitElement {
 *     _admins = new EasyDBQueryController(this, db.users.where('role', 'admin'));
 *
 *     render() {
 *       const { data, loading, error } = this._admins;
 *       if (loading) return html`<spinner-el></spinner-el>`;
 *       return html`${data.map(u => html`<user-card .user=${u}></user-card>`)}`;
 *     }
 *   }
 *
 * Lit 2+ is a peer dependency — not bundled with EasyDB.
 */

/**
 * Detect if the input is a StoreAccessor or a QueryBuilder.
 */
function resolve(queryOrStore) {
  const isStore = queryOrStore && typeof queryOrStore.all === 'function'
    && typeof queryOrStore.watch === 'function'
    && typeof queryOrStore.put === 'function';
  return {
    query: isStore ? queryOrStore.all() : queryOrStore,
    store: isStore ? queryOrStore : null,
  };
}

/**
 * Lit ReactiveController that executes an EasyDB query and
 * triggers host updates on data changes.
 *
 * Implements the ReactiveController interface (hostConnected/hostDisconnected).
 */
export class EasyDBQueryController {
  /**
   * @param {ReactiveControllerHost} host - The Lit element
   * @param {QueryBuilder|StoreAccessor} queryOrStore
   * @param {object} [opts]
   * @param {boolean} [opts.watch=true] - Auto-refresh when data changes
   */
  constructor(host, queryOrStore, opts = {}) {
    this._host = host;
    this._queryOrStore = queryOrStore;
    this._watchEnabled = opts.watch !== false;
    this.data = [];
    this.loading = true;
    this.error = null;
    this._watcherCleanup = null;

    host.addController(this);
  }

  hostConnected() {
    this._refresh();
    this._setupWatcher();
  }

  hostDisconnected() {
    this._cleanupWatcher();
  }

  refresh() {
    this._refresh();
  }

  _refresh() {
    const { query } = resolve(this._queryOrStore);
    this.loading = true;
    this.error = null;
    this._host.requestUpdate();

    query.toArray()
      .then(results => {
        this.data = results;
        this.loading = false;
        this._host.requestUpdate();
      })
      .catch(err => {
        this.error = err;
        this.loading = false;
        this._host.requestUpdate();
      });
  }

  _setupWatcher() {
    this._cleanupWatcher();
    if (!this._watchEnabled) return;

    const { store } = resolve(this._queryOrStore);
    if (!store) return;

    const watcher = store.watch()[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done } = await watcher.next();
        if (done || cancelled) break;
        this._refresh();
      }
    })();

    this._watcherCleanup = () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }

  _cleanupWatcher() {
    if (this._watcherCleanup) {
      this._watcherCleanup();
      this._watcherCleanup = null;
    }
  }
}

/**
 * Lit ReactiveController that tracks SyncEngine status
 * and triggers host updates on sync events.
 */
export class EasyDBSyncStatusController {
  /**
   * @param {ReactiveControllerHost} host - The Lit element
   * @param {import('./sync.js').SyncEngine} syncEngine
   */
  constructor(host, syncEngine) {
    this._host = host;
    this._syncEngine = syncEngine;
    this.running = syncEngine.running;
    this.paused = syncEngine.paused;
    this.lastEvent = null;
    this.error = null;
    this._timer = null;
    this._originalOnSync = null;
    this._originalOnError = null;

    host.addController(this);
  }

  hostConnected() {
    this._originalOnSync = this._syncEngine._onSync;
    this._originalOnError = this._syncEngine._onError;

    this._syncEngine._onSync = (event) => {
      this.lastEvent = event;
      this.running = this._syncEngine.running;
      this.paused = this._syncEngine.paused;
      this._host.requestUpdate();
      if (this._originalOnSync) this._originalOnSync(event);
    };

    this._syncEngine._onError = (err, context) => {
      this.error = { err, context };
      this._host.requestUpdate();
      if (this._originalOnError) this._originalOnError(err, context);
    };

    this._timer = setInterval(() => {
      if (this.running !== this._syncEngine.running || this.paused !== this._syncEngine.paused) {
        this.running = this._syncEngine.running;
        this.paused = this._syncEngine.paused;
        this._host.requestUpdate();
      }
    }, 500);
  }

  hostDisconnected() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._syncEngine._onSync = this._originalOnSync;
    this._syncEngine._onError = this._originalOnError;
  }
}

/**
 * Lit ReactiveController that fetches a single record by key
 * and triggers host updates on data changes.
 */
export class EasyDBRecordController {
  /**
   * @param {ReactiveControllerHost} host - The Lit element
   * @param {StoreAccessor} store - e.g., db.users
   * @param {any} key - The primary key to fetch
   * @param {object} [opts]
   * @param {boolean} [opts.watch=true] - Auto-refresh when the record changes
   */
  constructor(host, store, key, opts = {}) {
    this._host = host;
    this._store = store;
    this._key = key;
    this._watchEnabled = opts.watch !== false;
    this.data = undefined;
    this.loading = true;
    this.error = null;
    this._watcherCleanup = null;

    host.addController(this);
  }

  hostConnected() {
    this._refresh();
    this._setupWatcher();
  }

  hostDisconnected() {
    this._cleanupWatcher();
  }

  refresh() {
    this._refresh();
  }

  _refresh() {
    this.loading = true;
    this.error = null;
    this._host.requestUpdate();

    this._store.get(this._key)
      .then(result => {
        this.data = result;
        this.loading = false;
        this._host.requestUpdate();
      })
      .catch(err => {
        this.error = err;
        this.loading = false;
        this._host.requestUpdate();
      });
  }

  _setupWatcher() {
    this._cleanupWatcher();
    if (!this._watchEnabled) return;

    const watcher = this._store.watch({ key: this._key })[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done } = await watcher.next();
        if (done || cancelled) break;
        this._refresh();
      }
    })();

    this._watcherCleanup = () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }

  _cleanupWatcher() {
    if (this._watcherCleanup) {
      this._watcherCleanup();
      this._watcherCleanup = null;
    }
  }
}
