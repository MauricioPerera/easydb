/**
 * In-Memory Adapter for EasyDB
 *
 * Stores data in plain Maps/Arrays. Useful for:
 * - Unit testing (no browser/polyfill needed)
 * - Server-side rendering (SSR)
 * - Serverless functions
 * - Prototyping
 *
 * Data does not persist between page reloads or process restarts.
 */

// ── MemoryConnection ─────────────────────────────────────

class MemoryConnection {
  constructor(name, dbData) {
    this._name = name;
    this._dbData = dbData;
  }

  get name() { return this._name; }
  get version() { return this._dbData.version; }
  get storeNames() { return Array.from(this._dbData.stores.keys()); }

  hasStore(name) { return this._dbData.stores.has(name); }

  getKeyPath(storeName) {
    const store = this._dbData.stores.get(storeName);
    return store ? store.keyPath : null;
  }

  close() { /* no-op for memory */ }

  _getStore(storeName) {
    const store = this._dbData.stores.get(storeName);
    if (!store) throw new Error(`EasyDB: Store "${storeName}" not found`);
    return store;
  }

  // ── Read ops ──

  async get(storeName, key) {
    const store = this._getStore(storeName);
    const value = store.data.get(key);
    return value !== undefined ? structuredClone(value) : undefined;
  }

  async getAll(storeName, opts = {}) {
    const store = this._getStore(storeName);
    let entries = this._sortedEntries(store, opts.index);

    if (opts.range) {
      entries = entries.filter(([key, val]) => {
        const cmp = opts.index ? val[opts.index] : key;
        return this._matchesRange(cmp, opts.range);
      });
    }

    if (opts.limit != null) {
      entries = entries.slice(0, opts.limit);
    }

    return entries.map(([, val]) => structuredClone(val));
  }

  async count(storeName, opts = {}) {
    const store = this._getStore(storeName);
    if (!opts.range) return store.data.size;

    let count = 0;
    for (const [key, val] of store.data) {
      const cmp = opts.index ? val[opts.index] : key;
      if (this._matchesRange(cmp, opts.range)) count++;
    }
    return count;
  }

  async getMany(storeName, keys) {
    const store = this._getStore(storeName);
    return keys.map(k => {
      const val = store.data.get(k);
      return val !== undefined ? structuredClone(val) : undefined;
    });
  }

  // ── Write ops ──

  async put(storeName, value) {
    const store = this._getStore(storeName);
    let key;

    if (store.keyPath) {
      key = value[store.keyPath];
      if (key == null && store.autoIncrement) {
        key = store.nextKey++;
        value = { ...value, [store.keyPath]: key };
      }
    } else if (store.autoIncrement) {
      key = store.nextKey++;
    } else {
      throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
    }

    // Enforce unique indexes
    for (const [idxName, idxOpts] of store.indexes) {
      if (idxOpts.unique && value[idxName] != null) {
        for (const [existingKey, existingVal] of store.data) {
          if (existingKey !== key && existingVal[idxName] === value[idxName]) {
            throw new DOMException(
              `Key already exists in the object store.`,
              'ConstraintError'
            );
          }
        }
      }
    }

    store.data.set(key, structuredClone(value));

    // Track highest key for autoIncrement
    if (store.autoIncrement && typeof key === 'number' && key >= store.nextKey) {
      store.nextKey = key + 1;
    }

    return key;
  }

  async delete(storeName, key) {
    this._getStore(storeName).data.delete(key);
  }

  async clear(storeName) {
    this._getStore(storeName).data.clear();
  }

  async putMany(storeName, items) {
    const keys = [];
    for (const item of items) {
      keys.push(await this.put(storeName, item));
    }
    return keys;
  }

  // ── Cursor (async generator) ──

  async *cursor(storeName, opts = {}) {
    const store = this._getStore(storeName);
    let entries = this._sortedEntries(store, opts.index);

    if (opts.range) {
      entries = entries.filter(([key, val]) => {
        const cmp = opts.index ? val[opts.index] : key;
        return this._matchesRange(cmp, opts.range);
      });
    }

    if (opts.direction === 'prev') {
      entries.reverse();
    }

    for (const [, val] of entries) {
      yield structuredClone(val);
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    // Snapshot stores for rollback on error
    const snapshots = new Map();
    for (const name of storeNames) {
      const store = this._getStore(name);
      snapshots.set(name, {
        data: new Map(
          Array.from(store.data.entries()).map(([k, v]) => [k, structuredClone(v)])
        ),
        nextKey: store.nextKey,
      });
    }

    const self = this;
    const proxy = new Proxy({}, {
      get(_, storeName) {
        return {
          get: (key) => self.get(storeName, key),
          put: (val) => self.put(storeName, val),
          delete: (key) => self.delete(storeName, key),
          getAll: () => self.getAll(storeName),
          count: () => self.count(storeName),
        };
      }
    });

    try {
      await fn(proxy);
    } catch (err) {
      // Rollback on error (data + metadata)
      for (const [name, snapshot] of snapshots) {
        const store = this._getStore(name);
        store.data.clear();
        for (const [k, v] of snapshot.data) store.data.set(k, v);
        store.nextKey = snapshot.nextKey;
      }
      throw err;
    }
  }

  // ── Internal helpers ──

  _compare(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  _matchesRange(val, range) {
    if (!range) return true;
    if ('lower' in range) {
      if (range.lowerOpen ? val <= range.lower : val < range.lower) return false;
    }
    if ('upper' in range) {
      if (range.upperOpen ? val >= range.upper : val > range.upper) return false;
    }
    return true;
  }

  _sortedEntries(store, indexName) {
    const entries = Array.from(store.data.entries());
    if (indexName) {
      return entries.sort((a, b) => {
        const cmp = this._compare(a[1][indexName], b[1][indexName]);
        return cmp !== 0 ? cmp : this._compare(a[0], b[0]); // tie-break by primary key
      });
    }
    return entries.sort((a, b) => this._compare(a[0], b[0]));
  }
}

// ── MemoryAdapter ────────────────────────────────────────

export class MemoryAdapter {
  constructor() {
    this._databases = new Map();
  }

  async open(name, options = {}) {
    let dbData = this._databases.get(name);
    const version = options.version ?? 1;

    if (!dbData || dbData.version < version) {
      if (!dbData) {
        dbData = { version: 0, stores: new Map() };
      }

      if (options.schema) {
        options.schema({
          createStore(storeName, opts = {}) {
            if (!dbData.stores.has(storeName)) {
              const storeData = {
                keyPath: opts.key || null,
                autoIncrement: opts.autoIncrement || false,
                indexes: new Map(),
                data: new Map(),
                nextKey: 1,
              };
              if (opts.indexes) {
                for (const idx of opts.indexes) {
                  const n = typeof idx === 'string' ? idx : idx.name;
                  const o = typeof idx === 'string' ? {} : idx;
                  storeData.indexes.set(n, { unique: o.unique || false });
                }
              }
              dbData.stores.set(storeName, storeData);
            }
          },
          getStore(storeName) {
            return null; // Not supported in memory adapter schema migrations
          }
        }, dbData.version);
      }

      dbData.version = version;
      this._databases.set(name, dbData);
    }

    return new MemoryConnection(name, dbData);
  }

  async destroy(name) {
    this._databases.delete(name);
  }
}
