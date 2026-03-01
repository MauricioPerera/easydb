/**
 * localStorage Adapter for EasyDB
 *
 * Stores data in browser localStorage using JSON serialization.
 * Best for small datasets that need to persist across page reloads
 * without the complexity of IndexedDB.
 *
 * Limitations:
 * - ~5MB storage limit (browser-dependent)
 * - Synchronous reads/writes (wrapped as async for API compat)
 * - No native indexes — queries filter in JS
 * - No true transactions — best-effort with rollback on error
 * - String keys only in localStorage
 *
 * Usage:
 *   import EasyDB from '@rckflr/easydb';
 *   import { LocalStorageAdapter } from '@rckflr/easydb/adapters/localstorage';
 *
 *   const db = await EasyDB.open('app', {
 *     adapter: new LocalStorageAdapter(),
 *     schema(s) {
 *       s.createStore('settings', { key: 'key' });
 *       s.createStore('bookmarks', { key: 'id', autoIncrement: true });
 *     }
 *   });
 */

// ── LocalStorageConnection ────────────────────────────────

class LocalStorageConnection {
  constructor(name, stores, version, prefix) {
    this._name = name;
    this._stores = stores; // Map<storeName, { keyPath, autoIncrement, indexes, nextKey }>
    this._version = version;
    this._prefix = prefix;
  }

  get name() { return this._name; }
  get version() { return this._version; }
  get storeNames() { return Array.from(this._stores.keys()); }

  hasStore(name) { return this._stores.has(name); }

  getKeyPath(storeName) {
    const meta = this._stores.get(storeName);
    return meta ? meta.keyPath : null;
  }

  close() { /* no-op */ }

  // ── Key helpers ──

  _skey(store) { return `${this._prefix}s:${store}`; }
  _mkey() { return `${this._prefix}_meta`; }

  _meta(storeName) {
    const meta = this._stores.get(storeName);
    if (!meta) throw new Error(`EasyDB: Store "${storeName}" not found`);
    return meta;
  }

  _readStore(storeName) {
    const raw = localStorage.getItem(this._skey(storeName));
    return raw ? JSON.parse(raw) : {};
  }

  _writeStore(storeName, data) {
    localStorage.setItem(this._skey(storeName), JSON.stringify(data));
  }

  _saveMeta() {
    const obj = {};
    for (const [name, meta] of this._stores) {
      obj[name] = meta;
    }
    localStorage.setItem(this._mkey(), JSON.stringify(obj));
  }

  // ── Read ops ──

  async get(storeName, key) {
    const data = this._readStore(storeName);
    const val = data[String(key)];
    return val !== undefined ? structuredClone(val) : undefined;
  }

  async getAll(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const data = this._readStore(storeName);
    let entries = Object.entries(data);

    if (opts.range) {
      const field = opts.index || meta.keyPath;
      entries = entries.filter(([, val]) => this._matchesRange(val[field], opts.range));
    }

    const sortField = opts.index || meta.keyPath;
    entries.sort((a, b) => {
      const va = a[1][sortField];
      const vb = b[1][sortField];
      return va < vb ? -1 : va > vb ? 1 : 0;
    });

    if (opts.limit != null) entries = entries.slice(0, opts.limit);

    return entries.map(([, val]) => structuredClone(val));
  }

  async count(storeName, opts = {}) {
    if (!opts.range && !opts.index) {
      const data = this._readStore(storeName);
      return Object.keys(data).length;
    }
    const results = await this.getAll(storeName, opts);
    return results.length;
  }

  async getMany(storeName, keys) {
    const data = this._readStore(storeName);
    return keys.map(k => {
      const val = data[String(k)];
      return val !== undefined ? structuredClone(val) : undefined;
    });
  }

  // ── Write ops ──

  async put(storeName, value) {
    const meta = this._meta(storeName);
    const data = this._readStore(storeName);
    let key;

    if (meta.keyPath) {
      key = value[meta.keyPath];
      if (key == null && meta.autoIncrement) {
        key = meta.nextKey++;
        value = { ...value, [meta.keyPath]: key };
        this._saveMeta();
      }
    } else if (meta.autoIncrement) {
      key = meta.nextKey++;
      this._saveMeta();
    } else {
      throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
    }

    if (meta.autoIncrement && typeof key === 'number' && key >= meta.nextKey) {
      meta.nextKey = key + 1;
      this._saveMeta();
    }

    // Enforce unique indexes
    for (const idx of meta.indexes) {
      if (idx.unique && value[idx.name] != null) {
        for (const [existingKey, existingVal] of Object.entries(data)) {
          if (String(existingKey) !== String(key) && existingVal[idx.name] === value[idx.name]) {
            throw new DOMException(
              'Key already exists in the object store.',
              'ConstraintError'
            );
          }
        }
      }
    }

    data[String(key)] = structuredClone(value);
    this._writeStore(storeName, data);
    return key;
  }

  async delete(storeName, key) {
    this._meta(storeName);
    const data = this._readStore(storeName);
    delete data[String(key)];
    this._writeStore(storeName, data);
  }

  async clear(storeName) {
    this._meta(storeName);
    this._writeStore(storeName, {});
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
    const meta = this._meta(storeName);
    const data = this._readStore(storeName);
    let entries = Object.entries(data);

    if (opts.range) {
      const field = opts.index || meta.keyPath;
      entries = entries.filter(([, val]) => this._matchesRange(val[field], opts.range));
    }

    const sortField = opts.index || meta.keyPath;
    entries.sort((a, b) => {
      const va = a[1][sortField];
      const vb = b[1][sortField];
      return va < vb ? -1 : va > vb ? 1 : 0;
    });

    if (opts.direction === 'prev') entries.reverse();

    for (const [, val] of entries) {
      yield structuredClone(val);
    }
  }

  // ── Multi-store transaction (best-effort) ──

  async transaction(storeNames, fn) {
    // Snapshot for rollback
    const snapshots = new Map();
    for (const name of storeNames) {
      snapshots.set(name, this._readStore(name));
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
      // Rollback
      for (const [name, snapshot] of snapshots) {
        this._writeStore(name, snapshot);
      }
      throw err;
    }
  }

  // ── Internal helpers ──

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
}

// ── LocalStorageAdapter ───────────────────────────────────

export class LocalStorageAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.prefix='easydb:'] - Key prefix for localStorage
   */
  constructor(opts = {}) {
    this._prefix = opts.prefix ?? 'easydb:';
  }

  async open(name, options = {}) {
    const version = options.version ?? 1;
    const prefix = `${this._prefix}${name}:`;
    const metaKey = `${prefix}_meta`;
    const versionKey = `${prefix}_version`;

    const currentVersion = JSON.parse(localStorage.getItem(versionKey) || '0');
    const stores = new Map();

    if (currentVersion < version && options.schema) {
      const storeDefs = [];

      options.schema({
        createStore(storeName, opts = {}) {
          storeDefs.push({ storeName, opts });
        },
        getStore() { return null; }
      }, currentVersion);

      // Load existing meta (if any)
      const existingMeta = JSON.parse(localStorage.getItem(metaKey) || '{}');

      for (const { storeName, opts } of storeDefs) {
        const indexes = [];
        if (opts.indexes) {
          for (const idx of opts.indexes) {
            const n = typeof idx === 'string' ? idx : idx.name;
            const unique = typeof idx === 'string' ? false : (idx.unique || false);
            indexes.push({ name: n, unique });
          }
        }

        const meta = {
          keyPath: opts.key || null,
          autoIncrement: opts.autoIncrement || false,
          indexes,
          nextKey: existingMeta[storeName]?.nextKey || 1,
        };

        stores.set(storeName, meta);
      }

      // Save meta
      const metaObj = {};
      for (const [n, m] of stores) metaObj[n] = m;
      localStorage.setItem(metaKey, JSON.stringify(metaObj));
      localStorage.setItem(versionKey, JSON.stringify(version));
    }

    // Load metadata if not set from schema
    if (stores.size === 0) {
      const existing = JSON.parse(localStorage.getItem(metaKey) || '{}');
      for (const [storeName, meta] of Object.entries(existing)) {
        stores.set(storeName, meta);
      }
    }

    return new LocalStorageConnection(name, stores, version, prefix);
  }

  async destroy(name) {
    const prefix = `${this._prefix}${name}:`;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }
}
