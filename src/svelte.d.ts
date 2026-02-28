import type { Readable } from 'svelte/store';

interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

interface RecordState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
}

interface QueryStoreResult<T> extends Readable<QueryState<T>> {
  refresh: () => void;
}

interface RecordStoreResult<T> extends Readable<RecordState<T>> {
  refresh: () => void;
}

interface QueryStoreOptions {
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

export declare function queryStore<T = any>(
  queryOrStore: QueryLike<T> | StoreLike<T>,
  opts?: QueryStoreOptions,
): QueryStoreResult<T>;

export declare function recordStore<T = any>(
  store: StoreLike<T>,
  key: any,
  opts?: QueryStoreOptions,
): RecordStoreResult<T>;
