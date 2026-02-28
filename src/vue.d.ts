import type { Ref } from 'vue';

interface QueryResult<T> {
  data: Ref<T[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  refresh: () => void;
}

interface RecordResult<T> {
  data: Ref<T | undefined>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  refresh: () => void;
}

interface QueryOptions {
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
  queryOrStore: QueryLike<T> | StoreLike<T> | Ref<QueryLike<T> | StoreLike<T>>,
  opts?: QueryOptions,
): QueryResult<T>;

export declare function useRecord<T = any>(
  store: StoreLike<T>,
  key: any | Ref<any>,
  opts?: QueryOptions,
): RecordResult<T>;
