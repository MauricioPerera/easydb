/**
 * React integration for EasyDB
 *
 * @example
 * import { useQuery, useRecord } from '@rckflr/easydb/react';
 *
 * function AdminList({ db }) {
 *   const { data, loading } = useQuery(db.users.where('role', 'admin'));
 *   return data.map(u => <span key={u.id}>{u.name}</span>);
 * }
 */

import type { QueryBuilder, StoreAccessor } from './easydb.js';

export interface UseQueryResult<T> {
  /** The fetched data (empty array while loading). */
  data: T[];
  /** True while the initial fetch or a refresh is in progress. */
  loading: boolean;
  /** Error if the query failed, null otherwise. */
  error: Error | null;
  /** Manually re-fetch the query. */
  refresh: () => void;
}

export interface UseRecordResult<T> {
  /** The fetched record, or undefined if not found / still loading. */
  data: T | undefined;
  /** True while fetching. */
  loading: boolean;
  /** Error if the fetch failed, null otherwise. */
  error: Error | null;
  /** Manually re-fetch the record. */
  refresh: () => void;
}

export interface UseQueryOptions {
  /** Auto-refresh when data changes via watch(). Default: true. */
  watch?: boolean;
}

/**
 * React hook that executes an EasyDB query and returns reactive data.
 *
 * Pass a QueryBuilder for filtered queries, or a StoreAccessor for all records.
 * When `watch` is enabled (default), automatically re-fetches when mutations occur.
 *
 * @example
 * // All admins, auto-refreshes on mutations
 * const { data } = useQuery(db.users.where('role', 'admin'));
 *
 * // All users, no auto-refresh
 * const { data } = useQuery(db.users, { watch: false });
 *
 * // Paginated
 * const { data } = useQuery(db.users.all().page(page, 20));
 */
export function useQuery<T>(
  queryOrStore: QueryBuilder<T> | StoreAccessor<T>,
  opts?: UseQueryOptions,
): UseQueryResult<T>;

/**
 * React hook that fetches a single record by key.
 *
 * @example
 * const { data: user, loading } = useRecord(db.users, userId);
 */
export function useRecord<T>(
  store: StoreAccessor<T>,
  key: any,
  opts?: UseQueryOptions,
): UseRecordResult<T>;

export interface UseSyncStatusResult {
  /** Whether the sync engine is currently running. */
  running: boolean;
  /** Whether the sync engine is paused. */
  paused: boolean;
  /** The last sync event emitted, or null. */
  lastEvent: import('./sync.js').SyncEvent | null;
  /** The last sync error, or null. */
  error: { err: Error; context: import('./sync.js').SyncErrorContext } | null;
}

/**
 * React hook that tracks SyncEngine status reactively.
 *
 * @example
 * const { running, paused, lastEvent, error } = useSyncStatus(syncEngine);
 */
export function useSyncStatus(
  syncEngine: import('./sync.js').SyncEngine,
): UseSyncStatusResult;
