/**
 * Solid.js integration for EasyDB
 *
 * @example
 * import { createQuery, createRecord } from '@rckflr/easydb/solid';
 *
 * function AdminList() {
 *   const admins = createQuery(() => db.users.where('role', 'admin'));
 *   return <For each={admins.data()}>{u => <span>{u.name}</span>}</For>;
 * }
 */

import type { Accessor } from 'solid-js';

interface QueryResult<T> {
  data: Accessor<T[]>;
  loading: Accessor<boolean>;
  error: Accessor<Error | null>;
  refresh: () => void;
}

interface RecordResult<T> {
  data: Accessor<T | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<Error | null>;
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
  running: Accessor<boolean>;
  paused: Accessor<boolean>;
  lastEvent: Accessor<import('./sync.js').SyncEvent | null>;
  error: Accessor<{ err: Error; context: import('./sync.js').SyncErrorContext } | null>;
}

export declare function createSyncStatus(
  syncEngine: import('./sync.js').SyncEngine,
): SyncStatusResult;
