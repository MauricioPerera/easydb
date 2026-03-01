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

export interface QueryResult<T> {
  data: Accessor<T[]>;
  loading: Accessor<boolean>;
  error: Accessor<Error | null>;
  refresh: () => void;
}

export interface RecordResult<T> {
  data: Accessor<T | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<Error | null>;
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

export declare function createQuery<T = any>(
  queryOrStore: QueryLike<T> | StoreLike<T> | (() => QueryLike<T> | StoreLike<T>),
  opts?: QueryOptions,
): QueryResult<T>;

export declare function createRecord<T = any>(
  store: StoreLike<T>,
  key: any | (() => any),
  opts?: QueryOptions,
): RecordResult<T>;

export interface SyncStatusResult {
  running: Accessor<boolean>;
  paused: Accessor<boolean>;
  lastEvent: Accessor<import('./sync.js').SyncEvent | null>;
  error: Accessor<{ err: Error; context: import('./sync.js').SyncErrorContext } | null>;
}

export declare function createSyncStatus(
  syncEngine: import('./sync.js').SyncEngine,
): SyncStatusResult;
