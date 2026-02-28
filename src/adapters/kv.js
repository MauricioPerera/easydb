/**
 * Cloudflare KV Adapter for EasyDB
 *
 * Maps EasyDB stores to KV key-value entries. Best for:
 * - Configuration stores, user preferences, session data
 * - Key-value access patterns (get/put/delete by key)
 * - Small-to-medium datasets where full scans are acceptable
 *
 * Limitations vs D1/IDB:
 * - No native indexes — queries fetch all records and filter in JS
 * - No true transactions — best-effort with rollback on error
 * - Eventually consistent (KV propagation delay)
 * - getAll/cursor/where require list + get per key
 *
 * Usage in Cloudflare Workers:
 *
 *   import EasyDB, { KVAdapter } from '@rckflr/easydb';
 *
 *   export default {
 *     async fetch(request, env) {
 *       const db = await EasyDB.open('app', {
 *         adapter: new KVAdapter(env.MY_KV),
 *         schema(s) {
 *           s.createStore('config', { key: 'key' });
 *           s.createStore('sessions', { key: 'id', indexes: ['userId'] });
 *         }
 *       });
 *       await db.config.put({ key: 'theme', value: 'dark' });
 *     }
 *   };
 */

// ── KVConnection ─────────────────────────────────────────

class KVConnection {
  constructor(name, kv, stores, version, prefix) {
    this._name = name;
    this._kv = kv;
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

  close() { /* no-op — KV connections are stateless */ }

  // ── Key helpers ──

  _rkey(store, pk) { return `${this._prefix}r:${store}:${pk}`; }
  _mkey(store) { return `${this._prefix}m:${store}`; }
  _listPrefix(store) { return `${this._prefix}r:${store}:`; }

  _meta(storeName) {
    const meta = this._stores.get(storeName);
    if (!meta) throw new Error(`EasyDB: Store "${storeName}" not found`);
    return meta;
  }

  // ── Read ops ──

  async get(storeName, key) {
    this._meta(storeName);
    const val = await this._kv.get(this._rkey(storeName, key), 'json');
    return val ?? undefined;
  }

  async getAll(storeName, opts = {}) {
    const meta = this._meta(storeName);
    let results = await this._fetchAll(storeName);

    if (opts.range) {
      const field = opts.index || meta.keyPath;
      results = results.filter(v => this._matchesRange(v[field], opts.range));
    }

    const sortField = opts.index || meta.keyPath;
    results.sort((a, b) => a[sortField] < b[sortField] ? -1 : a[sortField] > b[sortField] ? 1 : 0);

    if (opts.limit != null) results = results.slice(0, opts.limit);

    return results;
  }

  async count(storeName, opts = {}) {
    if (!opts.range && !opts.index) {
      const meta = this._meta(storeName);
      const keys = await this._listKeys(storeName);
      return keys.length;
    }
    const results = await this.getAll(storeName, opts);
    return results.length;
  }

  async getMany(storeName, keys) {
    this._meta(storeName);
    return Promise.all(keys.map(k => this.get(storeName, k)));
  }

  // ── Write ops ──

  async put(storeName, value) {
    const meta = this._meta(storeName);
    let key;

    if (meta.keyPath) {
      key = value[meta.keyPath];
      if (key == null && meta.autoIncrement) {
        key = meta.nextKey++;
        value = { ...value, [meta.keyPath]: key };
        await this._saveMeta(storeName, meta);
      }
    } else if (meta.autoIncrement) {
      key = meta.nextKey++;
      await this._saveMeta(storeName, meta);
    } else {
      throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
    }

    if (meta.autoIncrement && typeof key === 'number' && key >= meta.nextKey) {
      meta.nextKey = key + 1;
      await this._saveMeta(storeName, meta);
    }

    // Enforce unique indexes
    if (meta.indexes.length > 0) {
      const uniqueIndexes = meta.indexes.filter(i => i.unique);
      if (uniqueIndexes.length > 0) {
        const all = await this._fetchAll(storeName);
        for (const idx of uniqueIndexes) {
          if (value[idx.name] != null) {
            const conflict = all.find(v =>
              v[meta.keyPath] !== key && v[idx.name] === value[idx.name]
            );
            if (conflict) {
              throw new DOMException(
                'Key already exists in the object store.',
                'ConstraintError'
              );
            }
          }
        }
      }
    }

    await this._kv.put(this._rkey(storeName, key), JSON.stringify(value));
    return key;
  }

  async delete(storeName, key) {
    this._meta(storeName);
    await this._kv.delete(this._rkey(storeName, key));
  }

  async clear(storeName) {
    this._meta(storeName);
    const keys = await this._listKeys(storeName);
    await Promise.all(keys.map(k => this._kv.delete(k)));
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
    let results = await this._fetchAll(storeName);

    if (opts.range) {
      const field = opts.index || meta.keyPath;
      results = results.filter(v => this._matchesRange(v[field], opts.range));
    }

    const sortField = opts.index || meta.keyPath;
    results.sort((a, b) => a[sortField] < b[sortField] ? -1 : a[sortField] > b[sortField] ? 1 : 0);

    if (opts.direction === 'prev') results.reverse();

    for (const val of results) {
      yield val;
    }
  }

  // ── Multi-store transaction (best-effort) ──

  async transaction(storeNames, fn) {
    // Snapshot for rollback
    const snapshots = new Map();
    for (const name of storeNames) {
      snapshots.set(name, await this._fetchAll(name));
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
      // Rollback: clear and re-insert
      for (const [name, snapshot] of snapshots) {
        await this.clear(name);
        for (const item of snapshot) {
          const meta = this._meta(name);
          const key = item[meta.keyPath];
          await this._kv.put(this._rkey(name, key), JSON.stringify(item));
        }
      }
      throw err;
    }
  }

  // ── Internal helpers ──

  async _listKeys(storeName) {
    const prefix = this._listPrefix(storeName);
    const keys = [];
    let cursor = undefined;

    do {
      const list = await this._kv.list({ prefix, cursor, limit: 1000 });
      for (const k of list.keys) keys.push(k.name);
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    return keys;
  }

  async _fetchAll(storeName) {
    const keys = await this._listKeys(storeName);
    if (keys.length === 0) return [];

    const values = await Promise.all(
      keys.map(k => this._kv.get(k, 'json'))
    );

    return values.filter(v => v != null);
  }

  async _saveMeta(storeName, meta) {
    await this._kv.put(this._mkey(storeName), JSON.stringify({
      keyPath: meta.keyPath,
      autoIncrement: meta.autoIncrement,
      indexes: meta.indexes,
      nextKey: meta.nextKey,
    }));
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
}

// ── KVAdapter ─────────────────────────────────────────────

export class KVAdapter {
  /**
   * @param {KVNamespace} kv - Cloudflare KV namespace binding
   * @param {object} [opts]
   * @param {string} [opts.prefix='easydb:'] - Key prefix to avoid collisions
   */
  constructor(kv, opts = {}) {
    this._kv = kv;
    this._prefix = opts.prefix ?? 'easydb:';
  }

  async open(name, options = {}) {
    const version = options.version ?? 1;
    const prefix = `${this._prefix}${name}:`;
    const versionKey = `${prefix}_version`;

    // Check current version
    const currentVersion = await this._kv.get(versionKey, 'json') || 0;

    const stores = new Map();

    if (currentVersion < version && options.schema) {
      const storeDefs = [];

      options.schema({
        createStore(storeName, opts = {}) {
          storeDefs.push({ storeName, opts });
        },
        getStore() { return null; }
      }, currentVersion);

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
          nextKey: 1,
        };

        // Preserve existing nextKey if store already exists
        const existingMeta = await this._kv.get(`${prefix}m:${storeName}`, 'json');
        if (existingMeta && existingMeta.nextKey) {
          meta.nextKey = existingMeta.nextKey;
        }

        stores.set(storeName, meta);
        await this._kv.put(`${prefix}m:${storeName}`, JSON.stringify(meta));
      }

      await this._kv.put(versionKey, JSON.stringify(version));
    }

    // Load metadata for all known stores (if not loaded from schema)
    if (stores.size === 0) {
      // List all meta keys to discover stores
      const metaPrefix = `${prefix}m:`;
      let cursor = undefined;
      do {
        const list = await this._kv.list({ prefix: metaPrefix, cursor, limit: 1000 });
        for (const k of list.keys) {
          const storeName = k.name.slice(metaPrefix.length);
          const meta = await this._kv.get(k.name, 'json');
          if (meta) stores.set(storeName, meta);
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);
    }

    return new KVConnection(name, this._kv, stores, version, prefix);
  }

  async destroy(name) {
    const prefix = `${this._prefix}${name}:`;

    // Delete everything with this prefix
    let cursor = undefined;
    do {
      const list = await this._kv.list({ prefix, cursor, limit: 1000 });
      await Promise.all(list.keys.map(k => this._kv.delete(k.name)));
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }
}
