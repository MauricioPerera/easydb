/**
 * Cloudflare D1 Adapter for EasyDB
 *
 * Maps EasyDB stores to D1 (SQLite) tables. Each store becomes a table
 * with the keyPath as primary key, a _value column for the full JSON,
 * and additional columns for indexed fields (enabling native SQL queries).
 *
 * Usage in Cloudflare Workers:
 *
 *   import EasyDB, { D1Adapter } from 'easydb';
 *
 *   export default {
 *     async fetch(request, env) {
 *       const db = await EasyDB.open('app', {
 *         adapter: new D1Adapter(env.DB),
 *         schema(s) {
 *           s.createStore('users', { key: 'id', indexes: ['role'] });
 *         }
 *       });
 *       const user = await db.users.get(1);
 *     }
 *   };
 */

// Escape SQL identifiers (prevent injection via double-quote in names)
function _esc(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// ── D1Connection ─────────────────────────────────────────

class D1Connection {
  constructor(name, d1, stores, version) {
    this._name = name;
    this._d1 = d1;
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

  close() { /* no-op — D1 connections are stateless */ }

  // ── Read ops ──

  async get(storeName, key) {
    const meta = this._meta(storeName);
    const row = await this._d1.prepare(
      `SELECT "_value" FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?1`
    ).bind(key).first();
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
      sql += ` LIMIT ?${params.length}`;
    }

    const { results } = await this._d1.prepare(sql).bind(...params).all();
    return results.map(r => JSON.parse(r._value));
  }

  async count(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    let sql = `SELECT COUNT(*) AS _cnt FROM ${_esc(storeName)}`;
    const params = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, params)}`;
    }

    const row = await this._d1.prepare(sql).bind(...params).first();
    return row._cnt;
  }

  async getMany(storeName, keys) {
    return Promise.all(keys.map(k => this.get(storeName, k)));
  }

  // ── Write ops ──

  async put(storeName, value) {
    const meta = this._meta(storeName);
    let key = meta.keyPath ? value[meta.keyPath] : undefined;

    // Build columns: [keyPath?, _value, ...indexes]
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

    const placeholders = params.map((_, i) => `?${i + 1}`).join(', ');

    if (key != null && meta.keyPath) {
      // Upsert — known key
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
      await this._d1.prepare(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`
      ).bind(...params).run();
      return key;
    }

    if (meta.autoIncrement) {
      // Use RETURNING to atomically get the generated key
      const row = await this._d1.prepare(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING ${_esc(meta.keyPath)}`
      ).bind(...params).first();
      key = row[meta.keyPath];
      // Back-patch the generated key into the _value JSON
      if (meta.keyPath) {
        const updated = { ...value, [meta.keyPath]: key };
        await this._d1.prepare(
          `UPDATE ${_esc(storeName)} SET "_value" = ?1 WHERE ${_esc(meta.keyPath)} = ?2`
        ).bind(JSON.stringify(updated), key).run();
      }
      return key;
    }

    throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
  }

  async delete(storeName, key) {
    const meta = this._meta(storeName);
    await this._d1.prepare(
      `DELETE FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?1`
    ).bind(key).run();
  }

  async clear(storeName) {
    await this._d1.prepare(`DELETE FROM ${_esc(storeName)}`).run();
  }

  async putMany(storeName, items) {
    const meta = this._meta(storeName);
    if (meta.autoIncrement) {
      // AutoIncrement needs RETURNING — must go sequentially
      for (const item of items) {
        await this.put(storeName, item);
      }
      return;
    }
    // Non-autoIncrement: batch for atomicity
    const stmts = items.map(item => this._buildPutStmt(storeName, item));
    await this._d1.batch(stmts);
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

    const { results } = await this._d1.prepare(sql).bind(...params).all();
    for (const row of results) {
      yield JSON.parse(row._value);
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    // Snapshot affected stores for rollback on error
    const snapshots = new Map();
    for (const name of storeNames) {
      const { results } = await this._d1.prepare(
        `SELECT * FROM ${_esc(name)}`
      ).all();
      snapshots.set(name, results);
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
      // Rollback: restore each store from snapshot
      for (const [name, rows] of snapshots) {
        await this._d1.prepare(`DELETE FROM ${_esc(name)}`).run();
        if (rows.length) {
          const cols = Object.keys(rows[0]);
          const colsSql = cols.map(c => _esc(c)).join(', ');
          for (const row of rows) {
            const placeholders = cols.map((_, i) => `?${i + 1}`).join(', ');
            const vals = cols.map(c => row[c]);
            await this._d1.prepare(
              `INSERT INTO ${_esc(name)} (${colsSql}) VALUES (${placeholders})`
            ).bind(...vals).run();
          }
        }
      }
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
      conditions.push(`${_esc(column)} ${op} ?${params.length}`);
    }
    if ('upper' in range) {
      const op = range.upperOpen ? '<' : '<=';
      params.push(range.upper);
      conditions.push(`${_esc(column)} ${op} ?${params.length}`);
    }
    return conditions.join(' AND ');
  }

  _buildPutStmt(storeName, value) {
    const meta = this._meta(storeName);
    const key = meta.keyPath ? value[meta.keyPath] : undefined;

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

    const placeholders = params.map((_, i) => `?${i + 1}`).join(', ');

    if (key != null && meta.keyPath) {
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
      return this._d1.prepare(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`
      ).bind(...params);
    }

    return this._d1.prepare(
      `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders})`
    ).bind(...params);
  }
}

// ── D1Adapter ────────────────────────────────────────────

export class D1Adapter {
  constructor(d1) {
    this._d1 = d1;
  }

  async open(name, options = {}) {
    const version = options.version ?? 1;

    // Ensure metadata table exists
    await this._d1.prepare(
      `CREATE TABLE IF NOT EXISTS "_easydb_meta" ("store" TEXT PRIMARY KEY, "key_path" TEXT, "auto_increment" INTEGER DEFAULT 0, "indexes" TEXT DEFAULT '[]', "version" INTEGER DEFAULT 1)`
    ).run();

    // Check current schema version
    const row = await this._d1.prepare(
      `SELECT MAX("version") AS _v FROM "_easydb_meta"`
    ).first();
    const currentVersion = row?._v || 0;

    if (currentVersion < version && options.schema) {
      const storeDefs = [];

      options.schema({
        createStore(storeName, opts = {}) {
          storeDefs.push({ storeName, opts });
        },
        getStore() { return null; }
      }, currentVersion);

      const stmts = [];

      for (const { storeName, opts } of storeDefs) {
        const keyPath = opts.key || null;
        const autoIncrement = opts.autoIncrement || false;
        const indexes = [];

        // Build CREATE TABLE columns
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

        stmts.push(
          this._d1.prepare(`CREATE TABLE IF NOT EXISTS ${_esc(storeName)} (${cols.join(', ')})`)
        );

        for (const idx of indexes) {
          const u = idx.unique ? 'UNIQUE ' : '';
          stmts.push(
            this._d1.prepare(`CREATE ${u}INDEX IF NOT EXISTS ${_esc('idx_' + storeName + '_' + idx.name)} ON ${_esc(storeName)}(${_esc(idx.name)})`)
          );
        }

        stmts.push(
          this._d1.prepare(
            `INSERT OR REPLACE INTO "_easydb_meta" ("store", "key_path", "auto_increment", "indexes", "version") VALUES (?1, ?2, ?3, ?4, ?5)`
          ).bind(storeName, keyPath, autoIncrement ? 1 : 0, JSON.stringify(indexes), version)
        );
      }

      await this._d1.batch(stmts);
    }

    // Read all store metadata
    const { results } = await this._d1.prepare(
      `SELECT * FROM "_easydb_meta"`
    ).all();

    const stores = new Map();
    for (const r of results) {
      stores.set(r.store, {
        keyPath: r.key_path,
        autoIncrement: r.auto_increment === 1,
        indexes: JSON.parse(r.indexes),
      });
    }

    return new D1Connection(name, this._d1, stores, version);
  }

  async destroy(name) {
    try {
      const { results } = await this._d1.prepare(
        `SELECT "store" FROM "_easydb_meta"`
      ).all();

      const stmts = results.map(r =>
        this._d1.prepare(`DROP TABLE IF EXISTS ${_esc(r.store)}`)
      );
      stmts.push(this._d1.prepare(`DROP TABLE IF EXISTS "_easydb_meta"`));

      await this._d1.batch(stmts);
    } catch (_) {
      // If _easydb_meta doesn't exist, nothing to destroy
    }
  }
}
