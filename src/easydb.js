/**
 * EasyDB v2 — IndexedDB reimagined
 * 
 * A thin ergonomic wrapper over IndexedDB using modern JavaScript primitives:
 * async/await, async iterables, Proxy, and native IDB fast paths.
 * 
 * ~250 lines. Zero dependencies. Works in any modern browser.
 * 
 * @license MIT
 * @author Mauricio Perera <https://automators.work>
 * @see https://blog.cloudflare.com/a-better-web-streams-api/
 */

// ── Helpers ──────────────────────────────────────────────

function promisifyReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Aborted', 'AbortError'));
  });
}

// ── Watch engine (per-instance EventTarget) ──────────────

const _watchers = new Map(); // "dbName:storeName" -> Set<callback>

function _notify(dbName, storeName, type, key, value) {
  const id = `${dbName}:${storeName}`;
  const set = _watchers.get(id);
  if (set) for (const cb of set) cb({ type, key, value });
}

// ── QueryBuilder ─────────────────────────────────────────

export class QueryBuilder {
  constructor(idb, storeName, indexName = null, keyValue = null) {
    this._idb = idb;
    this._store = storeName;
    this._index = indexName;
    this._range = keyValue != null ? IDBKeyRange.only(keyValue) : null;
    this._limit = null;
    this._dir = 'next';
    this._filterFn = null;
    this._hasExactKey = keyValue != null;
  }

  _clone() {
    const q = new QueryBuilder(this._idb, this._store, this._index);
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

  // ── Range queries (generate native IDBKeyRange) ──

  gt(val) { const q = this._clone(); q._range = IDBKeyRange.lowerBound(val, true); return q; }
  gte(val) { const q = this._clone(); q._range = IDBKeyRange.lowerBound(val, false); return q; }
  lt(val) { const q = this._clone(); q._range = IDBKeyRange.upperBound(val, true); return q; }
  lte(val) { const q = this._clone(); q._range = IDBKeyRange.upperBound(val, false); return q; }
  between(lo, hi, loOpen = false, hiOpen = false) {
    const q = this._clone();
    q._range = IDBKeyRange.bound(lo, hi, loOpen, hiOpen);
    return q;
  }

  // ── JS-side compound filter ──

  filter(fn) {
    const q = this._clone();
    const prev = q._filterFn;
    q._filterFn = prev ? (v) => prev(v) && fn(v) : fn;
    return q;
  }

  // ── True pull-based async iterator ──

  [Symbol.asyncIterator]() {
    const self = this;
    let resolve = null;
    let reject = null;
    let done = false;
    let started = false;
    let request;

    function ensureStarted() {
      if (started) return;
      started = true;
      const tx = self._idb.transaction(self._store, 'readonly');
      const store = tx.objectStore(self._store);
      const source = self._index ? store.index(self._index) : store;
      request = source.openCursor(self._range, self._dir);
      request.onsuccess = () => {
        if (resolve) { const r = resolve; resolve = null; reject = null; r(request.result); }
      };
      request.onerror = () => {
        done = true;
        if (reject) { const rj = reject; resolve = null; reject = null; rj(request.error); }
      };
    }

    function waitCursor() {
      return new Promise((res, rej) => {
        resolve = res;
        reject = rej;
        if (request && request.readyState === 'done') {
          resolve = null;
          reject = null;
          if (request.error) { done = true; rej(request.error); }
          else { res(request.result); }
        }
      });
    }

    let count = 0;

    return {
      async next() {
        ensureStarted();
        while (true) {
          if (done) return { value: undefined, done: true };
          if (self._limit != null && count >= self._limit) return { value: undefined, done: true };

          const cursor = await waitCursor();
          if (!cursor) { done = true; return { value: undefined, done: true }; }

          const value = cursor.value;
          cursor.continue(); // advance for NEXT pull

          if (self._filterFn && !self._filterFn(value)) continue;

          count++;
          return { value, done: false };
        }
      },
      return() {
        done = true;
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() { return this; }
    };
  }

  // ── Consumption methods with fast paths ──

  async toArray() {
    // FAST PATH: no JS filter → use getAll(keyRange, count)
    // getAll(range, count) returns first N in ascending order,
    // so limit fast path only works for forward direction.
    if (!this._filterFn && (this._limit == null || this._dir === 'next')) {
      const tx = this._idb.transaction(this._store, 'readonly');
      const store = tx.objectStore(this._store);
      const source = this._index ? store.index(this._index) : store;
      const results = await promisifyReq(
        this._limit != null ? source.getAll(this._range, this._limit) : source.getAll(this._range)
      );
      if (this._dir === 'prev') results.reverse();
      return results;
    }
    // SLOW PATH: iterate with pull cursor (JS filter or desc+limit)
    const results = [];
    for await (const item of this) results.push(item);
    return results;
  }

  async first() {
    for await (const item of this.limit(1)) return item;
    return undefined;
  }

  async count() {
    // FAST PATH: use native IDB count when no JS filter
    if (!this._filterFn) {
      const tx = this._idb.transaction(this._store, 'readonly');
      const store = tx.objectStore(this._store);
      const source = this._index ? store.index(this._index) : store;
      return promisifyReq(source.count(this._range));
    }
    // SLOW PATH: must iterate (JS filter evaluates each record)
    let n = 0;
    for await (const _ of this) n++;
    return n;
  }
}

// ── StoreAccessor ────────────────────────────────────────

export class StoreAccessor {
  constructor(idb, storeName) {
    this._idb = idb;
    this._store = storeName;
  }

  async _run(mode, fn) {
    const tx = this._idb.transaction(this._store, mode);
    const store = tx.objectStore(this._store);
    const result = await promisifyReq(fn(store));
    await promisifyTx(tx);
    return result;
  }

  // ── CRUD ──

  async get(key) { return this._run('readonly', s => s.get(key)); }
  async getAll() { return this._run('readonly', s => s.getAll()); }
  async count() { return this._run('readonly', s => s.count()); }

  async getMany(keys) {
    const tx = this._idb.transaction(this._store, 'readonly');
    const store = tx.objectStore(this._store);
    return Promise.all(keys.map(k => promisifyReq(store.get(k))));
  }

  async put(value) {
    const tx = this._idb.transaction(this._store, 'readwrite');
    const store = tx.objectStore(this._store);
    const keyPath = store.keyPath;
    const result = await promisifyReq(store.put(value));
    await promisifyTx(tx);
    _notify(this._idb.name, this._store, 'put', keyPath ? value[keyPath] : result, value);
    return result;
  }

  async delete(key) {
    const result = await this._run('readwrite', s => s.delete(key));
    _notify(this._idb.name, this._store, 'delete', key, undefined);
    return result;
  }

  async clear() {
    const result = await this._run('readwrite', s => s.clear());
    _notify(this._idb.name, this._store, 'clear', null, undefined);
    return result;
  }

  async putMany(items) {
    const tx = this._idb.transaction(this._store, 'readwrite');
    const store = tx.objectStore(this._store);
    const keyPath = store.keyPath;
    for (const item of items) store.put(item);
    await promisifyTx(tx);
    for (const item of items) {
      _notify(this._idb.name, this._store, 'put', keyPath ? item[keyPath] : undefined, item);
    }
    return items.length;
  }

  // ── Query entry points ──

  where(indexName, value) {
    if (arguments.length === 2) {
      return new QueryBuilder(this._idb, this._store, indexName, value);
    }
    return new QueryBuilder(this._idb, this._store, indexName);
  }

  all() { return new QueryBuilder(this._idb, this._store); }

  // ── Watch (async iterable of mutations) ──

  watch(opts = {}) {
    const dbName = this._idb.name;
    const storeName = this._store;
    const keyFilter = opts.key;

    return {
      [Symbol.asyncIterator]() {
        const queue = [];
        let waiting = null;
        let done = false;
        const id = `${dbName}:${storeName}`;

        const cb = (evt) => {
          if (keyFilter != null && evt.key !== keyFilter) return;
          if (waiting) { const r = waiting; waiting = null; r({ value: evt, done: false }); }
          else queue.push(evt);
        };

        if (!_watchers.has(id)) _watchers.set(id, new Set());
        _watchers.get(id).add(cb);

        return {
          next() {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (done) return Promise.resolve({ value: undefined, done: true });
            return new Promise(r => waiting = r);
          },
          return() {
            done = true;
            const set = _watchers.get(id);
            if (set) { set.delete(cb); if (!set.size) _watchers.delete(id); }
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
  constructor(idb) {
    this._idb = idb;
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target || typeof prop === 'symbol') return target[prop];
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
        if (prop.startsWith('_')) return target[prop];
        return new StoreAccessor(idb, prop);
      }
    });
  }

  async transaction(storeNames, fn) {
    const tx = this._idb.transaction(storeNames, 'readwrite');
    const txProxy = new Proxy({}, {
      get(_, storeName) {
        const store = tx.objectStore(storeName);
        return {
          get: (key) => promisifyReq(store.get(key)),
          put: (val) => promisifyReq(store.put(val)),
          delete: (key) => promisifyReq(store.delete(key)),
          getAll: () => promisifyReq(store.getAll()),
          count: () => promisifyReq(store.count()),
        };
      }
    });
    try {
      await fn(txProxy);
      await promisifyTx(tx);
    } catch (err) {
      try { tx.abort(); } catch (_) {}
      throw err;
    }
  }

  close() {
    const prefix = this._idb.name + ':';
    for (const key of _watchers.keys()) {
      if (key.startsWith(prefix)) _watchers.delete(key);
    }
    this._idb.close();
  }

  static async open(name, options = {}) {
    return new Promise((resolve, reject) => {
      const version = options.version ?? 1;
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (options.schema) {
          options.schema({
            createStore(storeName, opts = {}) {
              if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, {
                  keyPath: opts.key || null,
                  autoIncrement: opts.autoIncrement || false,
                });
                if (opts.indexes) {
                  for (const idx of opts.indexes) {
                    const n = typeof idx === 'string' ? idx : idx.name;
                    const o = typeof idx === 'string' ? {} : idx;
                    store.createIndex(n, n, { unique: o.unique || false });
                  }
                }
              }
            },
            getStore(storeName) {
              return request.transaction.objectStore(storeName);
            }
          }, event.oldVersion);
        }
      };
      request.onsuccess = () => resolve(new EasyDB(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  static async destroy(name) {
    return promisifyReq(indexedDB.deleteDatabase(name));
  }
}

export default EasyDB;
