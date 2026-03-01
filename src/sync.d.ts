/**
 * EasyDB SyncEngine — Cross-adapter database synchronization.
 *
 * @license MIT
 */

import type { EasyDB } from './easydb.js';

/** Sync direction. */
export type SyncDirection = 'push' | 'pull' | 'bidirectional';

/** Built-in conflict resolution strategies. */
export type ConflictStrategy = 'last-write-wins' | 'source-wins' | 'target-wins' | 'manual';

/** Event emitted after each sync operation. */
export interface SyncEvent {
  /** The operation that triggered this event. */
  op: 'push' | 'pull' | 'syncAll';
  /** The store that was affected. */
  store: string;
  /** The type of mutation. */
  type: 'put' | 'delete' | 'clear';
  /** The key of the affected record (undefined for clear). */
  key?: any;
  /** Whether this event involved conflict resolution. */
  conflict?: boolean;
  /** Direction of the sync (for syncAll). */
  direction?: 'source→target' | 'target→source';
}

/** Error context passed to the onError callback. */
export interface SyncErrorContext {
  op: string;
  store: string;
  event?: any;
}

/** Options for the SyncEngine constructor. */
export interface SyncOptions {
  /** Store names to synchronize. */
  stores: string[];
  /** Sync direction. Default: 'push'. */
  direction?: SyncDirection;
  /** Conflict resolution strategy. Default: 'source-wins'. */
  conflict?: ConflictStrategy;
  /**
   * Manual conflict resolver. Called when conflict is 'manual'.
   * Return the resolved value, or undefined to skip.
   */
  onConflict?: (store: string, key: any, sourceVal: any, targetVal: any) => any;
  /** Polling interval for pull direction (ms). Default: 30000. */
  pullInterval?: number;
  /** Error handler. */
  onError?: (err: Error, context: SyncErrorContext) => void;
  /** Callback after each sync event. */
  onSync?: (event: SyncEvent) => void;
  /** Field name for last-write-wins timestamps. Default: '_syncedAt'. */
  timestampField?: string;
}

/**
 * Synchronizes data between two EasyDB instances.
 *
 * Supports push (watch-based), pull (polling), and bidirectional modes.
 *
 * @example
 * ```typescript
 * const sync = new SyncEngine(localDb, remoteDb, {
 *   stores: ['users', 'orders'],
 *   direction: 'bidirectional',
 *   conflict: 'last-write-wins',
 *   timestampField: 'updatedAt',
 * });
 *
 * sync.start();
 * ```
 */
export declare class SyncEngine {
  constructor(source: EasyDB, target: EasyDB, opts?: SyncOptions);

  /** Whether the sync engine is currently running. */
  readonly running: boolean;

  /** Whether the sync engine is paused. */
  readonly paused: boolean;

  /** Start synchronization according to configured direction. */
  start(): void;

  /** Stop all synchronization and clean up watchers/timers. */
  stop(): void;

  /** Pause sync — events are queued but not applied. */
  pause(): void;

  /** Resume sync — flush queued events. */
  resume(): Promise<void>;

  /**
   * Perform a one-time full sync of all configured stores.
   * Compares both sides and reconciles using the configured conflict strategy.
   */
  syncAll(): Promise<void>;

  /**
   * Perform a one-time full sync of a single store.
   */
  syncStore(storeName: string): Promise<void>;

  /**
   * Register a status listener. Returns an unsubscribe function.
   * Safe for multiple concurrent listeners.
   */
  addListener(listener: {
    onSync?: (event: SyncEvent) => void;
    onError?: (err: Error, context: SyncErrorContext) => void;
    onStatusChange?: (status: { running: boolean; paused: boolean }) => void;
  }): () => void;
}
