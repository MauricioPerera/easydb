/**
 * Preact integration for EasyDB
 *
 * Provides useQuery() and useRecord() hooks with automatic
 * re-rendering on mutations via watch().
 *
 * Usage:
 *   import { useQuery } from '@rckflr/easydb/preact';
 *
 *   function AdminList({ db }) {
 *     const { data, loading, error } = useQuery(db.users.where('role', 'admin'));
 *     if (loading) return <Spinner />;
 *     if (error) return <Error msg={error.message} />;
 *     return data.map(u => <UserCard key={u.id} user={u} />);
 *   }
 *
 * Preact is a peer dependency — not bundled with EasyDB.
 */

import { useState, useEffect, useRef } from 'preact/hooks';

/**
 * Preact hook that executes an EasyDB query and re-renders on data changes.
 *
 * @param {QueryBuilder|StoreAccessor} queryOrStore
 *   - QueryBuilder: executes .toArray()
 *   - StoreAccessor: executes .getAll() and watches the entire store
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when data changes via watch()
 * @returns {{ data: T[], loading: boolean, error: Error|null, refresh: () => void }}
 */
export function useQuery(queryOrStore, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const queryRef = useRef(queryOrStore);
  const versionRef = useRef(0);

  const isStore = queryOrStore && typeof queryOrStore.all === 'function'
    && typeof queryOrStore.watch === 'function'
    && typeof queryOrStore.put === 'function';

  const query = isStore ? queryOrStore.all() : queryOrStore;
  const store = isStore ? queryOrStore : null;

  queryRef.current = query;

  function refresh() {
    versionRef.current++;
    const ver = versionRef.current;

    setLoading(true);
    setError(null);

    query.toArray()
      .then(results => {
        if (versionRef.current === ver) {
          setData(results);
          setLoading(false);
        }
      })
      .catch(err => {
        if (versionRef.current === ver) {
          setError(err);
          setLoading(false);
        }
      });
  }

  useEffect(() => {
    refresh();
  }, [queryOrStore]);

  useEffect(() => {
    if (!watchEnabled || !store) return;

    const watcher = store.watch()[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done } = await watcher.next();
        if (done || cancelled) break;
        refresh();
      }
    })();

    return () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }, [watchEnabled, store]);

  return { data, loading, error, refresh };
}

/**
 * Preact hook that tracks SyncEngine status reactively.
 *
 * @param {import('./sync.js').SyncEngine} syncEngine
 * @returns {{ running: boolean, paused: boolean, lastEvent: SyncEvent|null, error: { err: Error, context: object }|null }}
 */
export function useSyncStatus(syncEngine) {
  const [running, setRunning] = useState(syncEngine.running);
  const [paused, setPaused] = useState(syncEngine.paused);
  const [lastEvent, setLastEvent] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    return syncEngine.addListener({
      onSync(event) {
        setLastEvent(event);
        setRunning(syncEngine.running);
        setPaused(syncEngine.paused);
      },
      onError(err, context) {
        setError({ err, context });
      },
    });
  }, [syncEngine]);

  return { running, paused, lastEvent, error };
}

/**
 * Preact hook that fetches a single record by key.
 *
 * @param {StoreAccessor} store - e.g., db.users
 * @param {any} key - The primary key to fetch
 * @param {object} [opts]
 * @param {boolean} [opts.watch=true] - Auto-refresh when the key changes
 * @returns {{ data: T|undefined, loading: boolean, error: Error|null, refresh: () => void }}
 */
export function useRecord(store, key, opts = {}) {
  const watchEnabled = opts.watch !== false;
  const [data, setData] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const versionRef = useRef(0);

  function refresh() {
    versionRef.current++;
    const ver = versionRef.current;

    setLoading(true);
    setError(null);

    store.get(key)
      .then(result => {
        if (versionRef.current === ver) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(err => {
        if (versionRef.current === ver) {
          setError(err);
          setLoading(false);
        }
      });
  }

  useEffect(() => {
    refresh();
  }, [store, key]);

  useEffect(() => {
    if (!watchEnabled) return;

    const watcher = store.watch({ key })[Symbol.asyncIterator]();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done } = await watcher.next();
        if (done || cancelled) break;
        refresh();
      }
    })();

    return () => {
      cancelled = true;
      if (watcher.return) watcher.return();
    };
  }, [watchEnabled, store, key]);

  return { data, loading, error, refresh };
}
