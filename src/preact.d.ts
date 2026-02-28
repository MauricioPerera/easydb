/**
 * Preact integration for EasyDB
 *
 * @example
 * import { useQuery, useRecord } from '@rckflr/easydb/preact';
 *
 * function AdminList({ db }) {
 *   const { data, loading } = useQuery(db.users.where('role', 'admin'));
 *   return data.map(u => <span key={u.id}>{u.name}</span>);
 * }
 */

export interface UseQueryResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export interface UseRecordResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export interface UseQueryOptions {
  watch?: boolean;
}

interface QueryLike<T = any> {
  toArray(): Promise<T[]>;
}

interface StoreLike<T = any> {
  all(): QueryLike<T>;
  get(key: any): Promise<T | undefined>;
  put(value: T): Promise<any>;
  watch(opts?: { key?: any }): AsyncIterable<any>;
}

export declare function useQuery<T = any>(
  queryOrStore: QueryLike<T> | StoreLike<T>,
  opts?: UseQueryOptions,
): UseQueryResult<T>;

export declare function useRecord<T = any>(
  store: StoreLike<T>,
  key: any,
  opts?: UseQueryOptions,
): UseRecordResult<T>;
