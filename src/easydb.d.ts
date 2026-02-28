/**
 * EasyDB — IndexedDB reimagined with async/await, async iterables, and modern JS.
 *
 * @license MIT
 * @author Mauricio Perera <https://automators.work>
 */

// ── QueryBuilder ─────────────────────────────────────────

export interface QueryBuilder<T> extends AsyncIterable<T> {
  /** Limit number of results. */
  limit(n: number): QueryBuilder<T>;
  /** Reverse order (descending). */
  desc(): QueryBuilder<T>;
  /** Forward order (ascending, default). */
  asc(): QueryBuilder<T>;

  /** Greater than (native IDBKeyRange). */
  gt(value: IDBValidKey): QueryBuilder<T>;
  /** Greater than or equal (native IDBKeyRange). */
  gte(value: IDBValidKey): QueryBuilder<T>;
  /** Less than (native IDBKeyRange). */
  lt(value: IDBValidKey): QueryBuilder<T>;
  /** Less than or equal (native IDBKeyRange). */
  lte(value: IDBValidKey): QueryBuilder<T>;
  /** Inclusive range (native IDBKeyRange). */
  between(
    lo: IDBValidKey,
    hi: IDBValidKey,
    loOpen?: boolean,
    hiOpen?: boolean,
  ): QueryBuilder<T>;

  /** JS-side filter predicate. Composable — multiple filters are ANDed. */
  filter(fn: (value: T) => boolean): QueryBuilder<T>;

  /** Collect all results into an array. Uses getAll() fast path when possible. */
  toArray(): Promise<T[]>;
  /** Get the first matching result, or undefined. */
  first(): Promise<T | undefined>;
  /** Count matching results. Uses native IDB count when possible. */
  count(): Promise<number>;

  [Symbol.asyncIterator](): AsyncIterator<T>;
}

// ── WatchEvent ───────────────────────────────────────────

export interface WatchEvent<T> {
  type: 'put' | 'delete' | 'clear';
  key: IDBValidKey | null;
  value: T | undefined;
}

export interface WatchOptions {
  /** Only emit events for this specific key. */
  key?: IDBValidKey;
}

// ── StoreAccessor ────────────────────────────────────────

export interface StoreAccessor<T> {
  /** Get a single record by key. */
  get(key: IDBValidKey): Promise<T | undefined>;
  /** Get all records in the store. */
  getAll(): Promise<T[]>;
  /** Count all records in the store. */
  count(): Promise<number>;
  /** Get multiple records by keys. Returns undefined for missing keys. */
  getMany(keys: IDBValidKey[]): Promise<(T | undefined)[]>;

  /** Insert or update a record. Returns the key. */
  put(value: T): Promise<IDBValidKey>;
  /** Delete a record by key. */
  delete(key: IDBValidKey): Promise<void>;
  /** Delete all records in the store. */
  clear(): Promise<void>;
  /** Insert or update multiple records. Returns the count. */
  putMany(items: T[]): Promise<number>;

  /** Query all records. Returns a QueryBuilder for chaining. */
  all(): QueryBuilder<T>;
  /** Query by index. Pass value for exact match, or chain with .gt()/.lt()/etc. */
  where(indexName: string, value?: IDBValidKey): QueryBuilder<T>;

  /** Watch for mutations. Returns an async iterable of WatchEvents. */
  watch(opts?: WatchOptions): AsyncIterable<WatchEvent<T>>;
}

// ── Schema & Options ─────────────────────────────────────

export interface StoreDefinition {
  /** Primary key path. */
  key?: string;
  /** Auto-increment the primary key. */
  autoIncrement?: boolean;
  /** Index definitions: string for simple, object for unique/compound. */
  indexes?: Array<string | { name: string; unique?: boolean }>;
}

export interface SchemaBuilder {
  /** Create a new object store. */
  createStore(name: string, opts?: StoreDefinition): void;
  /** Get an existing object store during upgrade. */
  getStore(name: string): IDBObjectStore;
}

export interface OpenOptions {
  /** Database version (default: 1). */
  version?: number;
  /** Schema definition callback, called during upgradeneeded. */
  schema?: (db: SchemaBuilder, oldVersion: number) => void;
}

// ── Transaction ──────────────────────────────────────────

export interface TransactionStore<T> {
  get(key: IDBValidKey): Promise<T | undefined>;
  put(value: T): Promise<IDBValidKey>;
  delete(key: IDBValidKey): Promise<void>;
  getAll(): Promise<T[]>;
  count(): Promise<number>;
}

export type TransactionProxy = {
  [storeName: string]: TransactionStore<any>;
};

// ── EasyDB ───────────────────────────────────────────────

export declare class EasyDB {
  /** The underlying IDBDatabase instance. */
  readonly _idb: IDBDatabase;

  /** List of available store names. */
  readonly stores: string[];

  /**
   * Explicitly access a store by name.
   * Use this when the store name collides with an EasyDB method
   * (e.g., "transaction", "close", "stores").
   */
  store(name: string): StoreAccessor<any>;

  /**
   * Run a multi-store readwrite transaction.
   * Automatically rolls back on throw.
   */
  transaction(
    storeNames: string[],
    fn: (tx: TransactionProxy) => Promise<void>,
  ): Promise<void>;

  /** Close the database connection and clean up watchers. */
  close(): void;

  /**
   * Open or create a database.
   * Returns a Proxy — access stores as properties (e.g., db.users).
   */
  static open(name: string, options?: OpenOptions): Promise<EasyDB & { [storeName: string]: StoreAccessor<any> }>;

  /** Delete a database. */
  static destroy(name: string): Promise<void>;

  /** Proxy: access any store as a property. */
  [storeName: string]: StoreAccessor<any> | any;
}

export default EasyDB;
