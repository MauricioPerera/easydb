/**
 * EasyDB — IndexedDB reimagined, now multi-backend
 *
 * A thin ergonomic wrapper using modern JavaScript primitives:
 * async/await, async iterables, Proxy, and native fast paths.
 *
 * Supports multiple storage backends via adapters:
 * - IDBAdapter (browser IndexedDB, default)
 * - MemoryAdapter (testing, SSR, serverless)
 * - D1Adapter (Cloudflare Workers D1/SQLite)
 *
 * Zero dependencies. Works in any modern browser or runtime.
 *
 * @license MIT
 * @author Mauricio Perera <https://automators.work>
 */

import { IDBAdapter } from './adapters/indexeddb.js';

// Re-export adapters for convenience
export { IDBAdapter } from './adapters/indexeddb.js';
export { MemoryAdapter } from './adapters/memory.js';
export { D1Adapter } from './adapters/d1.js';

// ── Watch engine ─────────────────────────────────────────

const _watchers = new Map(); // dbName -> Map<storeName, Set<callback>>

function _notify(dbName, storeName, type, key, value) {
  const dbMap = _watchers.get(dbName);
  if (!dbMap) return;
  const set = dbMap.get(storeName);
  if (set) for (const cb of set) cb({ type, key, value });
}

// ── QueryBuilder ─────────────────────────────────────────

export class QueryBuilder {
  constructor(conn, storeName, indexName = null, keyValue = null) {
    this._conn = conn;
    this._store = storeName;
    this._index = indexName;
    this._range = keyValue != null
      ? { lower: keyValue, upper: keyValue, lowerOpen: false, upperOpen: false }
      : null;
    this._limit = null;
    this._dir = 'next';
    this._filterFn = null;
    this._hasExactKey = keyValue != null;
  }

  _assertStore() {
    if (!this._conn.hasStore(this._store)) {
      const available = this._conn.storeNames.join(', ');
      throw new Error(
        `EasyDB: Store "${this._store}" not found. Available stores: ${available || '(none)'}`
      );
    }
  }

  _clone() {
    const q = new QueryBuilder(this._conn, this._store, this._index);
    q._range = this._range;
    q._limit = this._limit;
    q._dir = this._dir;
    q._filterFn = this._filterFn;
    q._hasExactKey = this._hasExactKey;
    return q;
  }

  // ── Chainable modifiers ──

  limit(n) { const q = this._clone(); q._limit = n; return q; }
  desc() { const q = this._clone(); q._dir = 'prev'; return q; }
  asc() { const q = this._clone(); q._dir = 'next'; return q; }

  // ── Range queries (adapter-agnostic range objects) ──

  gt(val) { const q = this._clone(); q._range = { lower: val, lowerOpen: true }; return q; }
  gte(val) { const q = this._clone(); q._range = { lower: val, lowerOpen: false }; return q; }
  lt(val) { const q = this._clone(); q._range = { upper: val, upperOpen: true }; return q; }
  lte(val) { const q = this._clone(); q._range = { upper: val, upperOpen: false }; return q; }
  between(lo, hi, loOpen = false, hiOpen = false) {
    const q = this._clone();
    q._range = { lower: lo, upper: hi, lowerOpen: loOpen, upperOpen: hiOpen };
    return q;
  }

  // ── JS-side compound filter ──

  filter(fn) {
    const q = this._clone();
    const prev = q._filterFn;
    q._filterFn = prev ? (v) => prev(v) && fn(v) : fn;
    return q;
  }

  // ── Async iterator (delegates to adapter cursor) ──

  [Symbol.asyncIterator]() {
    const self = this;
    let cursorIter = null;
    let count = 0;
    let done = false;

    return {
      async next() {
        if (!cursorIter) {
          self._assertStore();
          cursorIter = self._conn.cursor(self._store, {
            index: self._index,
            range: self._range,
            direction: self._dir,
          });
        }
        while (true) {
          if (done) return { value: undefined, done: true };
          if (self._limit != null && count >= self._limit) {
            done = true;
            if (cursorIter.return) cursorIter.return();
            return { value: undefined, done: true };
          }

          const result = await cursorIter.next();
          if (result.done) { done = true; return { value: undefined, done: true }; }

          const value = result.value;
          if (self._filterFn && !self._filterFn(value)) continue;

          count++;
          return { value, done: false };
        }
      },
      async return() {
        done = true;
        if (cursorIter && cursorIter.return) cursorIter.return();
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() { return this; }
    };
  }

  // ── Consumption methods with fast paths ──

  async toArray() {
    this._assertStore();
    // FAST PATH: no JS filter → use getAll(range, limit)
    // getAll returns first N in ascending order,
    // so limit fast path only works for forward direction.
    if (!this._filterFn && (this._limit == null || this._dir === 'next')) {
      const results = await this._conn.getAll(this._store, {
        index: this._index,
        range: this._range,
        limit: this._limit,
      });
      if (this._dir === 'prev') results.reverse();
      return results;
    }
    // SLOW PATH: iterate with cursor (JS filter or desc+limit)
    const results = [];
    for await (const item of this) results.push(item);
    return results;
  }

  async first() {
    for await (const item of this.limit(1)) return item;
    return undefined;
  }

  async count() {
    this._assertStore();
    // FAST PATH: use native count when no JS filter
    if (!this._filterFn) {
      return this._conn.count(this._store, {
        index: this._index,
        range: this._range,
      });
    }
    // SLOW PATH: must iterate (JS filter evaluates each record)
    let n = 0;
    for await (const _ of this) n++;
    return n;
  }
}

// ── StoreAccessor ────────────────────────────────────────

export class StoreAccessor {
  constructor(conn, storeName) {
    this._conn = conn;
    this._store = storeName;
  }

  _assertStore() {
    if (!this._conn.hasStore(this._store)) {
      const available = this._conn.storeNames.join(', ');
      throw new Error(
        `EasyDB: Store "${this._store}" not found. Available stores: ${available || '(none)'}`
      );
    }
  }

  // ── CRUD ──

  async get(key) {
    this._assertStore();
    return this._conn.get(this._store, key);
  }

  async getAll() {
    this._assertStore();
    return this._conn.getAll(this._store);
  }

  async count() {
    this._assertStore();
    return this._conn.count(this._store);
  }

  async getMany(keys) {
    this._assertStore();
    return this._conn.getMany(this._store, keys);
  }

  async put(value) {
    this._assertStore();
    const key = await this._conn.put(this._store, value);
    _notify(this._conn.name, this._store, 'put', key, value);
    return key;
  }

  async delete(key) {
    this._assertStore();
    await this._conn.delete(this._store, key);
    _notify(this._conn.name, this._store, 'delete', key, undefined);
  }

  async clear() {
    this._assertStore();
    await this._conn.clear(this._store);
    _notify(this._conn.name, this._store, 'clear', null, undefined);
  }

  async putMany(items) {
    this._assertStore();
    const keyPath = this._conn.getKeyPath(this._store);
    await this._conn.putMany(this._store, items);
    for (const item of items) {
      _notify(this._conn.name, this._store, 'put', keyPath ? item[keyPath] : undefined, item);
    }
    return items.length;
  }

  // ── Query entry points ──

  where(indexName, value) {
    if (arguments.length === 2) {
      return new QueryBuilder(this._conn, this._store, indexName, value);
    }
    return new QueryBuilder(this._conn, this._store, indexName);
  }

  all() { return new QueryBuilder(this._conn, this._store); }

  // ── Watch (async iterable of mutations) ──

  watch(opts = {}) {
    const dbName = this._conn.name;
    const storeName = this._store;
    const keyFilter = opts.key;

    return {
      [Symbol.asyncIterator]() {
        const queue = [];
        let waiting = null;
        let done = false;

        const cb = (evt) => {
          if (keyFilter != null && evt.key !== keyFilter) return;
          if (waiting) { const r = waiting; waiting = null; r({ value: evt, done: false }); }
          else queue.push(evt);
        };

        if (!_watchers.has(dbName)) _watchers.set(dbName, new Map());
        const dbMap = _watchers.get(dbName);
        if (!dbMap.has(storeName)) dbMap.set(storeName, new Set());
        dbMap.get(storeName).add(cb);

        return {
          next() {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (done) return Promise.resolve({ value: undefined, done: true });
            return new Promise(r => waiting = r);
          },
          return() {
            done = true;
            const dbMap = _watchers.get(dbName);
            if (dbMap) {
              const set = dbMap.get(storeName);
              if (set) { set.delete(cb); if (!set.size) dbMap.delete(storeName); }
              if (!dbMap.size) _watchers.delete(dbName);
            }
            if (waiting) { waiting({ value: undefined, done: true }); waiting = null; }
            return Promise.resolve({ value: undefined, done: true });
          },
          [Symbol.asyncIterator]() { return this; }
        };
      }
    };
  }
}

// ── EasyDB ───────────────────────────────────────────────

export class EasyDB {
  constructor(conn, adapter) {
    this._conn = conn;
    this._adapter = adapter;
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target || typeof prop === 'symbol') return target[prop];
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
        if (prop.startsWith('_')) return target[prop];
        return new StoreAccessor(conn, prop);
      }
    });
  }

  get stores() {
    return this._conn.storeNames;
  }

  get version() {
    return this._conn.version;
  }

  store(name) {
    return new StoreAccessor(this._conn, name);
  }

  async transaction(storeNames, fn) {
    return this._conn.transaction(storeNames, fn);
  }

  close() {
    _watchers.delete(this._conn.name);
    this._conn.close();
  }

  static async open(name, options = {}) {
    const adapter = options.adapter ?? new IDBAdapter();
    const conn = await adapter.open(name, options);
    return new EasyDB(conn, adapter);
  }

  static async destroy(name, options = {}) {
    const adapter = options.adapter ?? new IDBAdapter();
    return adapter.destroy(name);
  }
}

export default EasyDB;
