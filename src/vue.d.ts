import type { Ref } from 'vue';

export interface QueryResult<T> {
  data: Ref<T[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  refresh: () => void;
}

export interface RecordResult<T> {
  data: Ref<T | undefined>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  refresh: () => void;
}

export interface QueryOptions {
  watch?: boolean;
}

export interface QueryLike<T = any> {
  toArray(): Promise<T[]>;
}

export interface StoreLike<T = any> {
  all(): QueryLike<T>;
  get(key: any): Promise<T | undefined>;
  put(value: T): Promise<any>;
  watch(opts?: { key?: any }): AsyncIterable<any>;
}

export declare function useQuery<T = any>(
  queryOrStore: QueryLike<T> | StoreLike<T> | Ref<QueryLike<T> | StoreLike<T>>,
  opts?: QueryOptions,
): QueryResult<T>;

export declare function useRecord<T = any>(
  store: StoreLike<T>,
  key: any | Ref<any>,
  opts?: QueryOptions,
): RecordResult<T>;

export interface SyncStatusResult {
  running: Ref<boolean>;
  paused: Ref<boolean>;
  lastEvent: Ref<import('./sync.js').SyncEvent | null>;
  error: Ref<{ err: Error; context: import('./sync.js').SyncErrorContext } | null>;
}

export declare function useSyncStatus(
  syncEngine: import('./sync.js').SyncEngine,
): SyncStatusResult;
