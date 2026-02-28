/**
 * Vue integration for EasyDB
 *
 * Provides useQuery() and useRecord() composables with
 * automatic reactivity via watch().
 *
 * Usage:
 *   import { useQuery } from '@rckflr/easydb/vue';
 *
 *   const { data, loading, error } = useQuery(db.users.where('role', 'admin'));
 *
 * Vue 3 is a peer dependency — not bundled with EasyDB.
 */

import { ref, watch, onUnmounted, isRef, unref } from 'vue';

/**
 * Vue composable that executes an EasyDB query and re-renders on data changes.
 *
 * @param {QueryBuilder|StoreAccessor|Ref<QueryBuilder|StoreAccessor>} queryOrStore
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when data changes
 * @returns {{ data: Ref<T[]>, loading: Ref<boolean>, error: Ref<Error|null>, refresh: () => void }}
 */
export function useQuery(queryOrStore, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const data = ref([]);
  const loading = ref(true);
  const error = ref(null);
  let watcherCleanup = null;

  function resolve(input) {
    const q = isRef(input) ? unref(input) : input;
    // Detect StoreAccessor vs QueryBuilder
    const isStore = q && typeof q.all === 'function'
      && typeof q.watch === 'function'
      && typeof q.put === 'function';
    return {
      query: isStore ? q.all() : q,
      store: isStore ? q : null,
    };
  }

  function refresh() {
    const { query } = resolve(queryOrStore);
    loading.value = true;
    error.value = null;

    query.toArray()
      .then(results => {
        data.value = results;
        loading.value = false;
      })
      .catch(err => {
        error.value = err;
        loading.value = false;
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

  // Re-fetch when a ref changes
  if (isRef(queryOrStore)) {
    watch(queryOrStore, () => {
      refresh();
      setupWatcher();
    });
  }

  onUnmounted(cleanupWatcher);

  return { data, loading, error, refresh };
}

/**
 * Vue composable that fetches a single record by key.
 *
 * @param {StoreAccessor} store
 * @param {any|Ref<any>} key
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when the record changes
 * @returns {{ data: Ref<T|undefined>, loading: Ref<boolean>, error: Ref<Error|null>, refresh: () => void }}
 */
export function useRecord(store, key, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const data = ref(undefined);
  const loading = ref(true);
  const error = ref(null);
  let watcherCleanup = null;

  function refresh() {
    const k = isRef(key) ? unref(key) : key;
    loading.value = true;
    error.value = null;

    store.get(k)
      .then(result => {
        data.value = result;
        loading.value = false;
      })
      .catch(err => {
        error.value = err;
        loading.value = false;
      });
  }

  function setupWatcher() {
    cleanupWatcher();
    if (!watchEnabled) return;

    const k = isRef(key) ? unref(key) : key;
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

  // Re-fetch when key ref changes
  if (isRef(key)) {
    watch(key, () => {
      refresh();
      setupWatcher();
    });
  }

  onUnmounted(cleanupWatcher);

  return { data, loading, error, refresh };
}
