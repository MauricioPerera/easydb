/**
 * EasyDB — Multi-backend storage with async/await, async iterables, and modern JS.
 *
 * @license MIT
 * @author Mauricio Perera <https://automators.work>
 */

// ── Adapter interface ────────────────────────────────────

/** Adapter-agnostic key range (converted to IDBKeyRange by IDB adapter). */
export interface Range {
  lower?: any;
  lowerOpen?: boolean;
  upper?: any;
  upperOpen?: boolean;
}

/** Connection returned by an adapter's open() method. */
export interface AdapterConnection {
  readonly name: string;
  readonly version: number;
  readonly storeNames: string[];
  hasStore(name: string): boolean;
  getKeyPath(storeName: string): string | null;
  close(): void;

  get(storeName: string, key: any): Promise<any>;
  getAll(storeName: string, opts?: { index?: string; range?: Range; limit?: number }): Promise<any[]>;
  count(storeName: string, opts?: { index?: string; range?: Range }): Promise<number>;
  getMany(storeName: string, keys: any[]): Promise<any[]>;

  put(storeName: string, value: any): Promise<any>;
  delete(storeName: string, key: any): Promise<void>;
  clear(storeName: string): Promise<void>;
  putMany(storeName: string, items: any[]): Promise<any[]>;

  cursor(storeName: string, opts?: { index?: string; range?: Range; direction?: 'next' | 'prev' }): AsyncGenerator<any>;

  transaction(storeNames: string[], fn: (proxy: TransactionProxy) => Promise<void>): Promise<void>;
}

/** Storage adapter interface. Implement this to add a new backend. */
export interface Adapter {
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

// ── Adapters ─────────────────────────────────────────────

/** IndexedDB adapter (browser). Default when no adapter is specified. */
export declare class IDBAdapter implements Adapter {
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** In-memory adapter for testing, SSR, and serverless environments. */
export declare class MemoryAdapter implements Adapter {
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** Cloudflare D1 (SQLite) adapter for Workers. */
export declare class D1Adapter implements Adapter {
  constructor(d1: any);
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** Cloudflare KV adapter for Workers. */
export declare class KVAdapter implements Adapter {
  constructor(kv: any, opts?: { prefix?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** localStorage adapter for simple browser persistence. */
export declare class LocalStorageAdapter implements Adapter {
  constructor(opts?: { prefix?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** PostgreSQL adapter via node-postgres or Neon serverless. */
export declare class PostgresAdapter implements Adapter {
  constructor(client: any, opts?: { schema?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** Redis adapter via ioredis or @upstash/redis. */
export declare class RedisAdapter implements Adapter {
  constructor(redis: any, opts?: { prefix?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** Turso/libSQL adapter via @libsql/client. */
export declare class TursoAdapter implements Adapter {
  constructor(client: any);
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

/** SQLite adapter via better-sqlite3. File-based or in-memory. */
export declare class SQLiteAdapter implements Adapter {
  constructor(filename: string, opts?: Record<string, any>);
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}

// ── QueryBuilder ─────────────────────────────────────────

export interface QueryBuilder<T> extends AsyncIterable<T> {
  /** Limit number of results. */
  limit(n: number): QueryBuilder<T>;
  /** Skip the first N results. */
  skip(n: number): QueryBuilder<T>;
  /** Shorthand for `.skip((pageNum - 1) * pageSize).limit(pageSize)`. Pages are 1-indexed. */
  page(pageNum: number, pageSize: number): QueryBuilder<T>;
  /** Reverse order (descending). */
  desc(): QueryBuilder<T>;
  /** Forward order (ascending, default). */
  asc(): QueryBuilder<T>;

  /** Greater than. */
  gt(value: any): QueryBuilder<T>;
  /** Greater than or equal. */
  gte(value: any): QueryBuilder<T>;
  /** Less than. */
  lt(value: any): QueryBuilder<T>;
  /** Less than or equal. */
  lte(value: any): QueryBuilder<T>;
  /** Inclusive range. */
  between(lo: any, hi: any, loOpen?: boolean, hiOpen?: boolean): QueryBuilder<T>;

  /** JS-side filter predicate. Composable — multiple filters are ANDed. */
  filter(fn: (value: T) => boolean): QueryBuilder<T>;

  /** Collect all results into an array. Uses getAll() fast path when possible. */
  toArray(): Promise<T[]>;
  /** Get the first matching result, or undefined. */
  first(): Promise<T | undefined>;
  /** Count matching results. Uses native count when possible. */
  count(): Promise<number>;

  [Symbol.asyncIterator](): AsyncIterator<T>;
}

// ── WatchEvent ───────────────────────────────────────────

export interface WatchEvent<T> {
  type: 'put' | 'delete' | 'clear';
  key: any;
  value: T | undefined;
}

export interface WatchOptions {
  /** Only emit events for this specific key. */
  key?: any;
}

// ── StoreAccessor ────────────────────────────────────────

export interface StoreAccessor<T> {
  /** Get a single record by key. */
  get(key: any): Promise<T | undefined>;
  /** Get all records in the store. */
  getAll(): Promise<T[]>;
  /** Count all records in the store. */
  count(): Promise<number>;
  /** Get multiple records by keys. Returns undefined for missing keys. */
  getMany(keys: any[]): Promise<(T | undefined)[]>;

  /** Insert or update a record. Returns the key. */
  put(value: T): Promise<any>;
  /** Delete a record by key. */
  delete(key: any): Promise<void>;
  /** Delete all records in the store. */
  clear(): Promise<void>;
  /** Insert or update multiple records. Returns the count. */
  putMany(items: T[]): Promise<number>;

  /** Query all records. Returns a QueryBuilder for chaining. */
  all(): QueryBuilder<T>;
  /** Query by index. Pass value for exact match, or chain with .gt()/.lt()/etc. */
  where(indexName: string, value?: any): QueryBuilder<T>;

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
  /** Get an existing object store during upgrade (IDB adapter only). */
  getStore(name: string): any;
}

export interface OpenOptions {
  /** Database version (default: 1). */
  version?: number;
  /** Schema definition callback, called during upgrade. */
  schema?: (db: SchemaBuilder, oldVersion: number) => void;
  /**
   * Versioned migrations map. Each key is a version number, and the value
   * is a function that runs when upgrading past that version.
   * Auto-infers `version` from the highest key if not specified.
   * Cannot be used together with `schema`.
   */
  migrations?: Record<number, (db: SchemaBuilder, oldVersion: number) => void>;
  /** Storage adapter. Defaults to IDBAdapter. */
  adapter?: Adapter;
}

// ── Transaction ──────────────────────────────────────────

export interface TransactionStore<T> {
  get(key: any): Promise<T | undefined>;
  put(value: T): Promise<any>;
  delete(key: any): Promise<void>;
  getAll(): Promise<T[]>;
  count(): Promise<number>;
}

export type TransactionProxy = {
  [storeName: string]: TransactionStore<any>;
};

// ── Generic Schema Support ───────────────────────────────

/**
 * Schema type: maps store names to their record types.
 *
 * @example
 * interface MySchema {
 *   users: { id: number; name: string; role: string };
 *   orders: { orderId: string; total: number };
 * }
 */
type SchemaMap = Record<string, any>;

/** Typed transaction proxy — each store key maps to a typed TransactionStore. */
type TypedTransactionProxy<S extends SchemaMap> = {
  [K in keyof S & string]: TransactionStore<S[K]>;
};

/** Fully typed EasyDB instance with schema-aware store accessors. */
type TypedEasyDB<S extends SchemaMap> = {
  /** The adapter connection. */
  readonly _conn: AdapterConnection;
  /** List of available store names. */
  readonly stores: (keyof S & string)[];
  /** Database version. */
  readonly version: number;

  /**
   * Explicitly access a store by name (typed).
   * Use this when the store name collides with an EasyDB method.
   */
  store<K extends keyof S & string>(name: K): StoreAccessor<S[K]>;

  /**
   * Run a multi-store readwrite transaction (typed).
   * Automatically rolls back on throw.
   */
  transaction(
    storeNames: (keyof S & string)[],
    fn: (tx: TypedTransactionProxy<S>) => Promise<void>,
  ): Promise<void>;

  /** Close the database connection and clean up watchers. */
  close(): void;
} & {
  /** Proxy: access stores as typed properties. */
  readonly [K in keyof S & string]: StoreAccessor<S[K]>;
};

// ── EasyDB ───────────────────────────────────────────────

export declare class EasyDB {
  /** The adapter connection. */
  readonly _conn: AdapterConnection;

  /** List of available store names. */
  readonly stores: string[];

  /** Database version. */
  readonly version: number;

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
   * Open or create a database with a typed schema.
   * Returns a Proxy — access stores as typed properties.
   *
   * @example
   * interface Schema {
   *   users: { id: number; name: string; role: string };
   *   orders: { orderId: string; total: number };
   * }
   * const db = await EasyDB.open<Schema>('app', { ... });
   * const user = await db.users.get(1);  // Schema['users'] | undefined
   * const admins = await db.users.where('role', 'admin').toArray(); // Schema['users'][]
   */
  static open<S extends SchemaMap>(name: string, options?: OpenOptions): Promise<TypedEasyDB<S>>;

  /**
   * Open or create a database (untyped).
   * Returns a Proxy — access stores as properties (e.g., db.users).
   */
  static open(name: string, options?: OpenOptions): Promise<EasyDB & { [storeName: string]: StoreAccessor<any> }>;

  /**
   * Delete a database.
   * Pass options.adapter when using a non-default backend.
   */
  static destroy(name: string, options?: { adapter?: Adapter }): Promise<void>;

  /** Proxy: access any store as a property. */
  [storeName: string]: StoreAccessor<any> | any;
}

export default EasyDB;
