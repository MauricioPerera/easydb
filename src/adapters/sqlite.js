/**
 * SQLite Adapter for EasyDB (via better-sqlite3)
 *
 * Maps EasyDB stores to SQLite tables. Each store becomes a table
 * with the keyPath as primary key, a _value column for the full JSON,
 * and additional columns for indexed fields.
 *
 * Unlike the D1 adapter (Cloudflare-specific), this adapter works
 * anywhere Node.js runs: servers, CLI tools, Electron apps, etc.
 *
 * Advantages over D1:
 * - Synchronous, local-first — no network latency
 * - True ACID transactions via SQLite
 * - Works offline and in embedded environments
 *
 * Usage:
 *   import EasyDB from '@rckflr/easydb';
 *   import { SQLiteAdapter } from '@rckflr/easydb/adapters/sqlite';
 *
 *   const db = await EasyDB.open('app', {
 *     adapter: new SQLiteAdapter('./data.db'),
 *     schema(s) {
 *       s.createStore('users', { key: 'id', indexes: ['email'] });
 *     }
 *   });
 *
 *   // Or in-memory:
 *   const memDb = await EasyDB.open('test', {
 *     adapter: new SQLiteAdapter(':memory:'),
 *     schema(s) { s.createStore('items', { key: 'id' }); }
 *   });
 */

function _esc(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// ── SQLiteConnection ──────────────────────────────────────

class SQLiteConnection {
  constructor(name, sqlite, stores, version) {
    this._name = name;
    this._db = sqlite;
    this._stores = stores; // Map<storeName, { keyPath, autoIncrement, indexes }>
    this._version = version;
  }

  get name() { return this._name; }
  get version() { return this._version; }
  get storeNames() { return Array.from(this._stores.keys()); }

  hasStore(name) { return this._stores.has(name); }

  getKeyPath(storeName) {
    const meta = this._stores.get(storeName);
    return meta ? meta.keyPath : null;
  }

  close() { this._db.close(); }

  // ── Read ops ──

  async get(storeName, key) {
    const meta = this._meta(storeName);
    const row = this._db.prepare(
      `SELECT "_value" FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?`
    ).get(key);
    return row ? JSON.parse(row._value) : undefined;
  }

  async getAll(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    let sql = `SELECT "_value" FROM ${_esc(storeName)}`;
    const params = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, params)}`;
    }

    sql += ` ORDER BY ${_esc(orderCol)} ASC`;

    if (opts.limit != null) {
      params.push(opts.limit);
      sql += ` LIMIT ?`;
    }

    const rows = this._db.prepare(sql).all(...params);
    return rows.map(r => JSON.parse(r._value));
  }

  async count(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    let sql = `SELECT COUNT(*) AS _cnt FROM ${_esc(storeName)}`;
    const params = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, params)}`;
    }

    const row = this._db.prepare(sql).get(...params);
    return row._cnt;
  }

  async getMany(storeName, keys) {
    return Promise.all(keys.map(k => this.get(storeName, k)));
  }

  // ── Write ops ──

  async put(storeName, value) {
    const meta = this._meta(storeName);
    let key = meta.keyPath ? value[meta.keyPath] : undefined;

    const cols = [];
    const params = [];

    if (meta.keyPath && key != null) {
      cols.push(_esc(meta.keyPath));
      params.push(key);
    }

    cols.push('"_value"');
    params.push(JSON.stringify(value));

    for (const idx of meta.indexes) {
      cols.push(_esc(idx.name));
      params.push(value[idx.name] ?? null);
    }

    const placeholders = params.map(() => '?').join(', ');

    if (key != null && meta.keyPath) {
      // Upsert — known key
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
      this._db.prepare(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`
      ).run(...params);
      return key;
    }

    if (meta.autoIncrement) {
      const info = this._db.prepare(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders})`
      ).run(...params);
      key = Number(info.lastInsertRowid);

      // Back-patch the generated key into _value
      const updated = { ...value, [meta.keyPath]: key };
      const setClauses = [`"_value" = ?`];
      const updateParams = [JSON.stringify(updated)];

      for (const idx of meta.indexes) {
        setClauses.push(`${_esc(idx.name)} = ?`);
        updateParams.push(updated[idx.name] ?? null);
      }

      updateParams.push(key);
      this._db.prepare(
        `UPDATE ${_esc(storeName)} SET ${setClauses.join(', ')} WHERE ${_esc(meta.keyPath)} = ?`
      ).run(...updateParams);
      return key;
    }

    throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
  }

  async delete(storeName, key) {
    const meta = this._meta(storeName);
    this._db.prepare(
      `DELETE FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?`
    ).run(key);
  }

  async clear(storeName) {
    this._db.prepare(`DELETE FROM ${_esc(storeName)}`).run();
  }

  async putMany(storeName, items) {
    const meta = this._meta(storeName);

    if (meta.autoIncrement) {
      const keys = [];
      for (const item of items) {
        keys.push(await this.put(storeName, item));
      }
      return keys;
    }

    // Non-autoIncrement: batch within a SQLite transaction
    const keys = [];
    const txn = this._db.transaction(() => {
      for (const item of items) {
        const cols = [];
        const params = [];

        cols.push(_esc(meta.keyPath));
        params.push(item[meta.keyPath]);

        cols.push('"_value"');
        params.push(JSON.stringify(item));

        for (const idx of meta.indexes) {
          cols.push(_esc(idx.name));
          params.push(item[idx.name] ?? null);
        }

        const placeholders = params.map(() => '?').join(', ');
        const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
        const setClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');

        this._db.prepare(
          `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`
        ).run(...params);

        keys.push(item[meta.keyPath]);
      }
    });

    txn();
    return keys;
  }

  // ── Cursor (async generator) ──

  async *cursor(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    const dir = opts.direction === 'prev' ? 'DESC' : 'ASC';

    let sql = `SELECT "_value" FROM ${_esc(storeName)}`;
    const params = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, params)}`;
    }

    sql += ` ORDER BY ${_esc(orderCol)} ${dir}`;

    const rows = this._db.prepare(sql).all(...params);
    for (const row of rows) {
      yield JSON.parse(row._value);
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    // Use SQLite's native transaction for atomicity
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

    const txn = this._db.transaction(async () => {
      await fn(proxy);
    });

    // better-sqlite3 transactions are sync, but our fn is async.
    // Use savepoint-based manual approach instead.
    this._db.prepare('SAVEPOINT easydb_txn').run();
    try {
      await fn(proxy);
      this._db.prepare('RELEASE SAVEPOINT easydb_txn').run();
    } catch (err) {
      this._db.prepare('ROLLBACK TO SAVEPOINT easydb_txn').run();
      this._db.prepare('RELEASE SAVEPOINT easydb_txn').run();
      throw err;
    }
  }

  // ── Internal helpers ──

  _meta(storeName) {
    const meta = this._stores.get(storeName);
    if (!meta) throw new Error(`EasyDB: Store "${storeName}" not found`);
    return meta;
  }

  _where(column, range, params) {
    const conditions = [];
    if ('lower' in range) {
      const op = range.lowerOpen ? '>' : '>=';
      params.push(range.lower);
      conditions.push(`${_esc(column)} ${op} ?`);
    }
    if ('upper' in range) {
      const op = range.upperOpen ? '<' : '<=';
      params.push(range.upper);
      conditions.push(`${_esc(column)} ${op} ?`);
    }
    return conditions.join(' AND ');
  }
}

// ── SQLiteAdapter ─────────────────────────────────────────

export class SQLiteAdapter {
  /**
   * @param {string} filename - Path to SQLite file, or ':memory:' for in-memory
   * @param {object} [opts] - Options passed to better-sqlite3 constructor
   */
  constructor(filename, opts = {}) {
    this._filename = filename;
    this._opts = opts;
    this._Database = null;
  }

  async _loadDriver() {
    if (!this._Database) {
      const mod = await import('better-sqlite3');
      this._Database = mod.default || mod;
    }
    return this._Database;
  }

  async open(name, options = {}) {
    const Database = await this._loadDriver();
    const db = new Database(this._filename, this._opts);
    const version = options.version ?? 1;

    // Enable WAL mode for better concurrent reads
    db.pragma('journal_mode = WAL');

    // Ensure metadata table exists
    db.prepare(
      `CREATE TABLE IF NOT EXISTS "_easydb_meta" ("store" TEXT PRIMARY KEY, "key_path" TEXT, "auto_increment" INTEGER DEFAULT 0, "indexes" TEXT DEFAULT '[]', "version" INTEGER DEFAULT 1)`
    ).run();

    // Check current schema version
    const row = db.prepare(
      `SELECT MAX("version") AS _v FROM "_easydb_meta"`
    ).get();
    const currentVersion = row?._v || 0;

    if (currentVersion < version && options.schema) {
      const storeDefs = [];

      options.schema({
        createStore(storeName, opts = {}) {
          storeDefs.push({ storeName, opts });
        },
        getStore() { return null; }
      }, currentVersion);

      const migrate = db.transaction(() => {
        for (const { storeName, opts } of storeDefs) {
          const keyPath = opts.key || null;
          const autoIncrement = opts.autoIncrement || false;
          const indexes = [];

          const cols = [];
          if (keyPath) {
            cols.push(
              autoIncrement
                ? `${_esc(keyPath)} INTEGER PRIMARY KEY AUTOINCREMENT`
                : `${_esc(keyPath)} PRIMARY KEY`
            );
          }
          cols.push('"_value" TEXT NOT NULL');

          if (opts.indexes) {
            for (const idx of opts.indexes) {
              const n = typeof idx === 'string' ? idx : idx.name;
              const unique = typeof idx === 'string' ? false : (idx.unique || false);
              cols.push(_esc(n));
              indexes.push({ name: n, unique });
            }
          }

          db.prepare(
            `CREATE TABLE IF NOT EXISTS ${_esc(storeName)} (${cols.join(', ')})`
          ).run();

          for (const idx of indexes) {
            const u = idx.unique ? 'UNIQUE ' : '';
            db.prepare(
              `CREATE ${u}INDEX IF NOT EXISTS ${_esc('idx_' + storeName + '_' + idx.name)} ON ${_esc(storeName)}(${_esc(idx.name)})`
            ).run();
          }

          db.prepare(
            `INSERT OR REPLACE INTO "_easydb_meta" ("store", "key_path", "auto_increment", "indexes", "version") VALUES (?, ?, ?, ?, ?)`
          ).run(storeName, keyPath, autoIncrement ? 1 : 0, JSON.stringify(indexes), version);
        }
      });

      migrate();
    }

    // Read all store metadata
    const rows = db.prepare(`SELECT * FROM "_easydb_meta"`).all();

    const stores = new Map();
    for (const r of rows) {
      stores.set(r.store, {
        keyPath: r.key_path,
        autoIncrement: r.auto_increment === 1,
        indexes: JSON.parse(r.indexes),
      });
    }

    return new SQLiteConnection(name, db, stores, version);
  }

  async destroy(name) {
    const Database = await this._loadDriver();
    try {
      const db = new Database(this._filename, this._opts);
      const rows = db.prepare(`SELECT "store" FROM "_easydb_meta"`).all();

      const drop = db.transaction(() => {
        for (const r of rows) {
          db.prepare(`DROP TABLE IF EXISTS ${_esc(r.store)}`).run();
        }
        db.prepare(`DROP TABLE IF EXISTS "_easydb_meta"`).run();
      });
      drop();
      db.close();
    } catch (_) {
      // If database or _easydb_meta doesn't exist, nothing to destroy
    }
  }
}
