/**
 * Turso/libSQL Adapter for EasyDB
 *
 * Maps EasyDB stores to Turso (libSQL) tables. Similar to the D1 adapter
 * but uses the @libsql/client driver for Turso edge databases.
 *
 * Works with Turso hosted databases and local libSQL files.
 *
 * Usage:
 *   import EasyDB from '@rckflr/easydb';
 *   import { TursoAdapter } from '@rckflr/easydb/adapters/turso';
 *   import { createClient } from '@libsql/client';
 *
 *   const client = createClient({
 *     url: process.env.TURSO_URL,
 *     authToken: process.env.TURSO_AUTH_TOKEN,
 *   });
 *
 *   const db = await EasyDB.open('app', {
 *     adapter: new TursoAdapter(client),
 *     schema(s) {
 *       s.createStore('users', { key: 'id', indexes: ['email'] });
 *     }
 *   });
 */

function _esc(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// ── TursoConnection ───────────────────────────────────────

class TursoConnection {
  constructor(name, client, stores, version) {
    this._name = name;
    this._client = client;
    this._stores = stores;
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

  close() { /* no-op — client manages connections */ }

  // ── Read ops ──

  async get(storeName, key) {
    const meta = this._meta(storeName);
    const rs = await this._client.execute({
      sql: `SELECT "_value" FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?`,
      args: [key],
    });
    return rs.rows[0] ? JSON.parse(rs.rows[0]._value) : undefined;
  }

  async getAll(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    let sql = `SELECT "_value" FROM ${_esc(storeName)}`;
    const args = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, args)}`;
    }

    sql += ` ORDER BY ${_esc(orderCol)} ASC`;

    if (opts.limit != null) {
      args.push(opts.limit);
      sql += ` LIMIT ?`;
    }

    const rs = await this._client.execute({ sql, args });
    return rs.rows.map(r => JSON.parse(r._value));
  }

  async count(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    let sql = `SELECT COUNT(*) AS _cnt FROM ${_esc(storeName)}`;
    const args = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, args)}`;
    }

    const rs = await this._client.execute({ sql, args });
    return Number(rs.rows[0]._cnt);
  }

  async getMany(storeName, keys) {
    return Promise.all(keys.map(k => this.get(storeName, k)));
  }

  // ── Write ops ──

  async put(storeName, value) {
    const meta = this._meta(storeName);
    let key = meta.keyPath ? value[meta.keyPath] : undefined;

    const cols = [];
    const args = [];
    const placeholders = [];

    if (meta.keyPath && key != null) {
      cols.push(_esc(meta.keyPath));
      args.push(key);
      placeholders.push('?');
    }

    cols.push('"_value"');
    args.push(JSON.stringify(value));
    placeholders.push('?');

    for (const idx of meta.indexes) {
      cols.push(_esc(idx.name));
      args.push(value[idx.name] ?? null);
      placeholders.push('?');
    }

    if (key != null && meta.keyPath) {
      // Upsert
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');

      await this._client.execute({
        sql: `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`,
        args,
      });
      return key;
    }

    if (meta.autoIncrement) {
      const rs = await this._client.execute({
        sql: `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${_esc(meta.keyPath)}`,
        args,
      });
      key = rs.rows[0][meta.keyPath];

      // Back-patch
      const updated = { ...value, [meta.keyPath]: key };
      const updateArgs = [JSON.stringify(updated)];
      const setClauses = [`"_value" = ?`];

      for (const idx of meta.indexes) {
        updateArgs.push(updated[idx.name] ?? null);
        setClauses.push(`${_esc(idx.name)} = ?`);
      }

      updateArgs.push(key);
      await this._client.execute({
        sql: `UPDATE ${_esc(storeName)} SET ${setClauses.join(', ')} WHERE ${_esc(meta.keyPath)} = ?`,
        args: updateArgs,
      });
      return key;
    }

    throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
  }

  async delete(storeName, key) {
    const meta = this._meta(storeName);
    await this._client.execute({
      sql: `DELETE FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?`,
      args: [key],
    });
  }

  async clear(storeName) {
    await this._client.execute({ sql: `DELETE FROM ${_esc(storeName)}`, args: [] });
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

    // Batch for atomicity
    const stmts = items.map(item => this._buildPutStmt(storeName, item));
    await this._client.batch(stmts);
    return items.map(item => item[meta.keyPath]);
  }

  // ── Cursor (async generator) ──

  async *cursor(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    const dir = opts.direction === 'prev' ? 'DESC' : 'ASC';

    let sql = `SELECT "_value" FROM ${_esc(storeName)}`;
    const args = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, args)}`;
    }

    sql += ` ORDER BY ${_esc(orderCol)} ${dir}`;

    const rs = await this._client.execute({ sql, args });
    for (const row of rs.rows) {
      yield JSON.parse(row._value);
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    // Snapshot for rollback
    const snapshots = new Map();
    for (const name of storeNames) {
      const rs = await this._client.execute({
        sql: `SELECT * FROM ${_esc(name)}`,
        args: [],
      });
      snapshots.set(name, rs.rows);
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
      for (const [name, rows] of snapshots) {
        await this._client.execute({ sql: `DELETE FROM ${_esc(name)}`, args: [] });
        if (rows.length) {
          const cols = Object.keys(rows[0]);
          const colsSql = cols.map(c => _esc(c)).join(', ');
          for (const row of rows) {
            const placeholders = cols.map(() => '?').join(', ');
            const vals = cols.map(c => row[c]);
            await this._client.execute({
              sql: `INSERT INTO ${_esc(name)} (${colsSql}) VALUES (${placeholders})`,
              args: vals,
            });
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

  _where(column, range, args) {
    const conditions = [];
    if ('lower' in range) {
      const op = range.lowerOpen ? '>' : '>=';
      args.push(range.lower);
      conditions.push(`${_esc(column)} ${op} ?`);
    }
    if ('upper' in range) {
      const op = range.upperOpen ? '<' : '<=';
      args.push(range.upper);
      conditions.push(`${_esc(column)} ${op} ?`);
    }
    return conditions.join(' AND ');
  }

  _buildPutStmt(storeName, value) {
    const meta = this._meta(storeName);
    const key = meta.keyPath ? value[meta.keyPath] : undefined;

    const cols = [];
    const args = [];
    const placeholders = [];

    if (meta.keyPath && key != null) {
      cols.push(_esc(meta.keyPath));
      args.push(key);
      placeholders.push('?');
    }

    cols.push('"_value"');
    args.push(JSON.stringify(value));
    placeholders.push('?');

    for (const idx of meta.indexes) {
      cols.push(_esc(idx.name));
      args.push(value[idx.name] ?? null);
      placeholders.push('?');
    }

    if (key != null && meta.keyPath) {
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
      return {
        sql: `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`,
        args,
      };
    }

    return {
      sql: `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      args,
    };
  }
}

// ── TursoAdapter ──────────────────────────────────────────

export class TursoAdapter {
  /**
   * @param {import('@libsql/client').Client} client - libSQL client
   */
  constructor(client) {
    this._client = client;
  }

  async open(name, options = {}) {
    const version = options.version ?? 1;

    // Ensure metadata table exists
    await this._client.execute({
      sql: `CREATE TABLE IF NOT EXISTS "_easydb_meta" ("store" TEXT PRIMARY KEY, "key_path" TEXT, "auto_increment" INTEGER DEFAULT 0, "indexes" TEXT DEFAULT '[]', "version" INTEGER DEFAULT 1)`,
      args: [],
    });

    // Check current schema version
    const vrs = await this._client.execute({
      sql: `SELECT MAX("version") AS _v FROM "_easydb_meta"`,
      args: [],
    });
    const currentVersion = vrs.rows[0]?._v || 0;

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

        stmts.push({
          sql: `CREATE TABLE IF NOT EXISTS ${_esc(storeName)} (${cols.join(', ')})`,
          args: [],
        });

        for (const idx of indexes) {
          const u = idx.unique ? 'UNIQUE ' : '';
          stmts.push({
            sql: `CREATE ${u}INDEX IF NOT EXISTS ${_esc('idx_' + storeName + '_' + idx.name)} ON ${_esc(storeName)}(${_esc(idx.name)})`,
            args: [],
          });
        }

        stmts.push({
          sql: `INSERT OR REPLACE INTO "_easydb_meta" ("store", "key_path", "auto_increment", "indexes", "version") VALUES (?, ?, ?, ?, ?)`,
          args: [storeName, keyPath, autoIncrement ? 1 : 0, JSON.stringify(indexes), version],
        });
      }

      await this._client.batch(stmts);
    }

    // Read all store metadata
    const rs = await this._client.execute({
      sql: `SELECT * FROM "_easydb_meta"`,
      args: [],
    });

    const stores = new Map();
    for (const r of rs.rows) {
      stores.set(r.store, {
        keyPath: r.key_path,
        autoIncrement: r.auto_increment === 1,
        indexes: JSON.parse(r.indexes),
      });
    }

    return new TursoConnection(name, this._client, stores, version);
  }

  async destroy(name) {
    try {
      const rs = await this._client.execute({
        sql: `SELECT "store" FROM "_easydb_meta"`,
        args: [],
      });

      const stmts = rs.rows.map(r => ({
        sql: `DROP TABLE IF EXISTS ${_esc(r.store)}`,
        args: [],
      }));
      stmts.push({
        sql: `DROP TABLE IF EXISTS "_easydb_meta"`,
        args: [],
      });

      await this._client.batch(stmts);
    } catch (_) {
      // If _easydb_meta doesn't exist, nothing to destroy
    }
  }
}
