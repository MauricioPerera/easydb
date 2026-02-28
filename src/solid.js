/**
 * Solid.js integration for EasyDB
 *
 * Provides createQuery() and createRecord() primitives that return
 * Solid signals with automatic reactivity via watch().
 *
 * Usage:
 *   import { createQuery } from '@rckflr/easydb/solid';
 *
 *   function AdminList() {
 *     const admins = createQuery(() => db.users.where('role', 'admin'));
 *     return <For each={admins.data()}>{u => <span>{u.name}</span>}</For>;
 *   }
 *
 * Solid.js is a peer dependency — not bundled with EasyDB.
 */

import { createSignal, onCleanup, createEffect } from 'solid-js';

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
 * Creates Solid signals from an EasyDB query with automatic reactivity.
 *
 * @param {() => QueryBuilder|StoreAccessor | QueryBuilder|StoreAccessor} queryOrStore
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when data changes
 * @returns {{ data: Accessor<T[]>, loading: Accessor<boolean>, error: Accessor<Error|null>, refresh: () => void }}
 */
export function createQuery(queryOrStore, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const [data, setData] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  let watcherCleanup = null;

  function refresh() {
    const { query } = resolve(queryOrStore);
    setLoading(true);
    setError(null);

    query.toArray()
      .then(results => {
        setData(results);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
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

  // If queryOrStore is a function, use createEffect for tracking
  if (typeof queryOrStore === 'function') {
    createEffect(() => {
      queryOrStore(); // track reactive dependencies
      refresh();
      setupWatcher();
    });
  } else {
    // Static query — fetch once and set up watcher
    refresh();
    setupWatcher();
  }

  onCleanup(cleanupWatcher);

  return { data, loading, error, refresh };
}

/**
 * Creates Solid signals for a single record by key.
 *
 * @param {StoreAccessor} store - e.g., db.users
 * @param {any | (() => any)} key - The primary key (or accessor returning the key)
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when the record changes
 * @returns {{ data: Accessor<T|undefined>, loading: Accessor<boolean>, error: Accessor<Error|null>, refresh: () => void }}
 */
export function createRecord(store, key, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const [data, setData] = createSignal(undefined);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  let watcherCleanup = null;

  function resolveKey() {
    return typeof key === 'function' ? key() : key;
  }

  function refresh() {
    const k = resolveKey();
    setLoading(true);
    setError(null);

    store.get(k)
      .then(result => {
        setData(() => result);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
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

  // If key is a function (accessor), use createEffect
  if (typeof key === 'function') {
    createEffect(() => {
      key(); // track reactive dependencies
      refresh();
      setupWatcher();
    });
  } else {
    refresh();
    setupWatcher();
  }

  onCleanup(cleanupWatcher);

  return { data, loading, error, refresh };
}
