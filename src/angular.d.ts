/**
 * Angular integration for EasyDB
 *
 * @example
 * import { createQuery, createRecord } from '@rckflr/easydb/angular';
 *
 * @Component({ ... })
 * class AdminList {
 *   db = inject(DB_TOKEN);
 *   admins = createQuery(() => this.db.users.where('role', 'admin'));
 * }
 */

import type { Signal } from '@angular/core';

interface QueryResult<T> {
  data: Signal<T[]>;
  loading: Signal<boolean>;
  error: Signal<Error | null>;
  refresh: () => void;
}

interface RecordResult<T> {
  data: Signal<T | undefined>;
  loading: Signal<boolean>;
  error: Signal<Error | null>;
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

export declare function createQuery<T = any>(
  queryOrStore: QueryLike<T> | StoreLike<T> | (() => QueryLike<T> | StoreLike<T>),
  opts?: QueryOptions,
): QueryResult<T>;

export declare function createRecord<T = any>(
  store: StoreLike<T>,
  key: any | (() => any),
  opts?: QueryOptions,
): RecordResult<T>;

interface SyncStatusResult {
  running: Signal<boolean>;
  paused: Signal<boolean>;
  lastEvent: Signal<import('./sync.js').SyncEvent | null>;
  error: Signal<{ err: Error; context: import('./sync.js').SyncErrorContext } | null>;
  cleanup: () => void;
}

export declare function createSyncStatus(
  syncEngine: import('./sync.js').SyncEngine,
): SyncStatusResult;
