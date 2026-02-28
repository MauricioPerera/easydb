/**
 * Angular integration for EasyDB
 *
 * Provides createQuery() and createRecord() functions that return
 * Angular signals with automatic reactivity via watch().
 *
 * Usage:
 *   import { createQuery } from '@rckflr/easydb/angular';
 *
 *   @Component({ ... })
 *   class AdminList {
 *     db = inject(DB_TOKEN);
 *     admins = createQuery(() => this.db.users.where('role', 'admin'));
 *     // In template: @for (user of admins.data(); track user.id) { ... }
 *   }
 *
 * Angular 16+ is a peer dependency — not bundled with EasyDB.
 */

import { signal, effect, DestroyRef, inject } from '@angular/core';

/**
 * Detect if the input is a StoreAccessor or a QueryBuilder.
 */
function resolve(queryOrStore) {
  const q = typeof queryOrStore === 'function' ? queryOrStore() : queryOrStore;
  const isStore = q && typeof q.all === 'function'
    && typeof q.watch === 'function'
    && typeof q.put === 'function';
  return {
    query: isStore ? q.all() : q,
    store: isStore ? q : null,
  };
}

/**
 * Creates Angular signals from an EasyDB query with automatic reactivity.
 *
 * @param {() => QueryBuilder|StoreAccessor | QueryBuilder|StoreAccessor} queryOrStore
 *   - Function returning a QueryBuilder/StoreAccessor (reactive)
 *   - QueryBuilder: executes .toArray()
 *   - StoreAccessor: executes .getAll() and watches the entire store
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when data changes via watch()
 * @returns {{ data: Signal<T[]>, loading: Signal<boolean>, error: Signal<Error|null>, refresh: () => void }}
 */
export function createQuery(queryOrStore, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const data = signal([]);
  const loading = signal(true);
  const error = signal(null);
  let watcherCleanup = null;

  function refresh() {
    const { query } = resolve(queryOrStore);
    loading.set(true);
    error.set(null);

    query.toArray()
      .then(results => {
        data.set(results);
        loading.set(false);
      })
      .catch(err => {
        error.set(err);
        loading.set(false);
      });
  }

  function setupWatcher() {
    cleanupWatcher();
    if (!watchEnabled) return;

    const { store } = resolve(queryOrStore);
    if (!store) return;

    const watcher = store.watch()[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done } = await watcher.next();
        if (done || cancelled) break;
        refresh();
      }
    })();

    watcherCleanup = () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }

  function cleanupWatcher() {
    if (watcherCleanup) {
      watcherCleanup();
      watcherCleanup = null;
    }
  }

  // Initial fetch
  refresh();
  setupWatcher();

  // If called inside an injection context, auto-cleanup on destroy
  try {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(cleanupWatcher);
  } catch (_) {
    // Not in injection context — caller manages cleanup
  }

  // If queryOrStore is a function, use effect() to track signal changes
  if (typeof queryOrStore === 'function') {
    effect(() => {
      // Call the function to track signal dependencies
      queryOrStore();
      refresh();
      setupWatcher();
    });
  }

  return { data: data.asReadonly(), loading: loading.asReadonly(), error: error.asReadonly(), refresh };
}

/**
 * Creates Angular signals for a single record by key.
 *
 * @param {StoreAccessor} store - e.g., db.users
 * @param {any | (() => any)} key - The primary key (or a function/signal returning the key)
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when the record changes
 * @returns {{ data: Signal<T|undefined>, loading: Signal<boolean>, error: Signal<Error|null>, refresh: () => void }}
 */
export function createRecord(store, key, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const data = signal(undefined);
  const loading = signal(true);
  const error = signal(null);
  let watcherCleanup = null;

  function resolveKey() {
    return typeof key === 'function' ? key() : key;
  }

  function refresh() {
    const k = resolveKey();
    loading.set(true);
    error.set(null);

    store.get(k)
      .then(result => {
        data.set(result);
        loading.set(false);
      })
      .catch(err => {
        error.set(err);
        loading.set(false);
      });
  }

  function setupWatcher() {
    cleanupWatcher();
    if (!watchEnabled) return;

    const k = resolveKey();
    const watcher = store.watch({ key: k })[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done } = await watcher.next();
        if (done || cancelled) break;
        refresh();
      }
    })();

    watcherCleanup = () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }

  function cleanupWatcher() {
    if (watcherCleanup) {
      watcherCleanup();
      watcherCleanup = null;
    }
  }

  // Initial fetch
  refresh();
  setupWatcher();

  // Auto-cleanup in injection context
  try {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(cleanupWatcher);
  } catch (_) {
    // Not in injection context
  }

  // If key is a function (signal), track changes
  if (typeof key === 'function') {
    effect(() => {
      key();
      refresh();
      setupWatcher();
    });
  }

  return { data: data.asReadonly(), loading: loading.asReadonly(), error: error.asReadonly(), refresh };
}
