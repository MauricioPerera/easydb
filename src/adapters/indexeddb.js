/**
 * IndexedDB Adapter for EasyDB
 *
 * Wraps the browser IndexedDB API behind the EasyDB adapter interface.
 * This is the default adapter used when no adapter is specified.
 */

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

function toIDBRange(range) {
  if (!range) return null;
  const hasLower = 'lower' in range;
  const hasUpper = 'upper' in range;
  if (hasLower && hasUpper) {
    if (range.lower === range.upper && !range.lowerOpen && !range.upperOpen) {
      return IDBKeyRange.only(range.lower);
    }
    return IDBKeyRange.bound(
      range.lower, range.upper,
      range.lowerOpen ?? false, range.upperOpen ?? false
    );
  }
  if (hasLower) return IDBKeyRange.lowerBound(range.lower, range.lowerOpen ?? false);
  if (hasUpper) return IDBKeyRange.upperBound(range.upper, range.upperOpen ?? false);
  return null;
}

// ── IDBConnection ────────────────────────────────────────

class IDBConnection {
  constructor(idb) {
    this._idb = idb;
    this._keyPathCache = new Map();
  }

  get name() { return this._idb.name; }
  get version() { return this._idb.version; }
  get storeNames() { return Array.from(this._idb.objectStoreNames); }

  hasStore(name) { return this._idb.objectStoreNames.contains(name); }

  getKeyPath(storeName) {
    if (this._keyPathCache.has(storeName)) return this._keyPathCache.get(storeName);
    const tx = this._idb.transaction(storeName, 'readonly');
    const kp = tx.objectStore(storeName).keyPath;
    this._keyPathCache.set(storeName, kp);
    return kp;
  }

  close() { this._idb.close(); }

  // ── Read ops ──

  async get(storeName, key) {
    const tx = this._idb.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const result = await promisifyReq(store.get(key));
    await promisifyTx(tx);
    return result;
  }

  async getAll(storeName, opts = {}) {
    const tx = this._idb.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source = opts.index ? store.index(opts.index) : store;
    const range = toIDBRange(opts.range);
    const result = await promisifyReq(
      opts.limit != null ? source.getAll(range, opts.limit) : source.getAll(range)
    );
    await promisifyTx(tx);
    return result;
  }

  async count(storeName, opts = {}) {
    const tx = this._idb.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source = opts.index ? store.index(opts.index) : store;
    const result = await promisifyReq(source.count(toIDBRange(opts.range)));
    await promisifyTx(tx);
    return result;
  }

  async getMany(storeName, keys) {
    const tx = this._idb.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const results = await Promise.all(keys.map(k => promisifyReq(store.get(k))));
    await promisifyTx(tx);
    return results;
  }

  // ── Write ops ──

  async put(storeName, value) {
    const tx = this._idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const result = await promisifyReq(store.put(value));
    await promisifyTx(tx);
    return result;
  }

  async delete(storeName, key) {
    const tx = this._idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await promisifyReq(store.delete(key));
    await promisifyTx(tx);
  }

  async clear(storeName) {
    const tx = this._idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await promisifyReq(store.clear());
    await promisifyTx(tx);
  }

  async putMany(storeName, items) {
    const tx = this._idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) store.put(item);
    await promisifyTx(tx);
  }

  // ── Cursor (async generator) ──

  async *cursor(storeName, opts = {}) {
    const tx = this._idb.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source = opts.index ? store.index(opts.index) : store;
    const range = toIDBRange(opts.range);
    const dir = opts.direction ?? 'next';
    const request = source.openCursor(range, dir);

    let resolve, reject;
    let done = false;

    request.onsuccess = () => {
      if (resolve) { const r = resolve; resolve = null; reject = null; r(request.result); }
    };
    request.onerror = () => {
      done = true;
      if (reject) { const rj = reject; resolve = null; reject = null; rj(request.error); }
    };

    function waitCursor() {
      return new Promise((res, rej) => {
        resolve = res;
        reject = rej;
        if (request.readyState === 'done') {
          resolve = null;
          reject = null;
          if (request.error) { done = true; rej(request.error); }
          else { res(request.result); }
        }
      });
    }

    while (!done) {
      const cursor = await waitCursor();
      if (!cursor) break;
      const value = cursor.value;
      cursor.continue(); // advance BEFORE yield to keep tx alive
      yield value;
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    const tx = this._idb.transaction(storeNames, 'readwrite');
    const proxy = new Proxy({}, {
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
      await fn(proxy);
      await promisifyTx(tx);
    } catch (err) {
      try { tx.abort(); } catch (_) {}
      throw err;
    }
  }
}

// ── IDBAdapter ───────────────────────────────────────────

export class IDBAdapter {
  async open(name, options = {}) {
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
      request.onsuccess = () => resolve(new IDBConnection(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  async destroy(name) {
    return promisifyReq(indexedDB.deleteDatabase(name));
  }
}
