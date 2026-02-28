/**
 * PostgreSQL Adapter for EasyDB
 *
 * Maps EasyDB stores to PostgreSQL tables. Each store becomes a table
 * with the keyPath as primary key, a _value column for the full JSON,
 * and additional columns for indexed fields.
 *
 * Supports both node-postgres (pg) and Neon serverless (@neondatabase/serverless).
 * Just pass a Pool or Client instance.
 *
 * Usage:
 *   import EasyDB from '@rckflr/easydb';
 *   import { PostgresAdapter } from '@rckflr/easydb/adapters/postgres';
 *   import { Pool } from 'pg';
 *
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   const db = await EasyDB.open('app', {
 *     adapter: new PostgresAdapter(pool),
 *     schema(s) {
 *       s.createStore('users', { key: 'id', indexes: ['role'] });
 *     }
 *   });
 */

function _esc(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// ── PostgresConnection ────────────────────────────────────

class PostgresConnection {
  constructor(name, client, stores, version) {
    this._name = name;
    this._client = client;
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

  close() { /* no-op — pool manages connections */ }

  // ── Read ops ──

  async get(storeName, key) {
    const meta = this._meta(storeName);
    const { rows } = await this._client.query(
      `SELECT "_value" FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = $1`,
      [key]
    );
    return rows[0] ? JSON.parse(rows[0]._value) : undefined;
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
      sql += ` LIMIT $${params.length}`;
    }

    const { rows } = await this._client.query(sql, params);
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

    const { rows } = await this._client.query(sql, params);
    return parseInt(rows[0]._cnt, 10);
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
    const placeholders = [];

    if (meta.keyPath && key != null) {
      cols.push(_esc(meta.keyPath));
      params.push(key);
      placeholders.push(`$${params.length}`);
    }

    cols.push('"_value"');
    params.push(JSON.stringify(value));
    placeholders.push(`$${params.length}`);

    for (const idx of meta.indexes) {
      cols.push(_esc(idx.name));
      params.push(value[idx.name] ?? null);
      placeholders.push(`$${params.length}`);
    }

    if (key != null && meta.keyPath) {
      // Upsert
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map((c, i) => {
        // Find the parameter index for this column
        const colIdx = cols.indexOf(c);
        return `${c} = $${colIdx + 1}`;
      }).join(', ');

      await this._client.query(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT(${_esc(meta.keyPath)}) DO UPDATE SET ${setClause}`,
        params
      );
      return key;
    }

    if (meta.autoIncrement) {
      const { rows } = await this._client.query(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${_esc(meta.keyPath)}`,
        params
      );
      key = rows[0][meta.keyPath];

      // Back-patch the generated key into _value
      const updated = { ...value, [meta.keyPath]: key };
      const updateParams = [JSON.stringify(updated)];
      const setClauses = [`"_value" = $1`];

      for (const idx of meta.indexes) {
        updateParams.push(updated[idx.name] ?? null);
        setClauses.push(`${_esc(idx.name)} = $${updateParams.length}`);
      }

      updateParams.push(key);
      await this._client.query(
        `UPDATE ${_esc(storeName)} SET ${setClauses.join(', ')} WHERE ${_esc(meta.keyPath)} = $${updateParams.length}`,
        updateParams
      );
      return key;
    }

    throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
  }

  async delete(storeName, key) {
    const meta = this._meta(storeName);
    await this._client.query(
      `DELETE FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = $1`,
      [key]
    );
  }

  async clear(storeName) {
    await this._client.query(`DELETE FROM ${_esc(storeName)}`);
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
    // Non-autoIncrement: batch within a transaction
    await this._client.query('BEGIN');
    try {
      const keys = [];
      for (const item of items) {
        keys.push(await this.put(storeName, item));
      }
      await this._client.query('COMMIT');
      return keys;
    } catch (err) {
      await this._client.query('ROLLBACK');
      throw err;
    }
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

    const { rows } = await this._client.query(sql, params);
    for (const row of rows) {
      yield JSON.parse(row._value);
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    await this._client.query('BEGIN');

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
      await this._client.query('COMMIT');
    } catch (err) {
      await this._client.query('ROLLBACK');
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
      conditions.push(`${_esc(column)} ${op} $${params.length}`);
    }
    if ('upper' in range) {
      const op = range.upperOpen ? '<' : '<=';
      params.push(range.upper);
      conditions.push(`${_esc(column)} ${op} $${params.length}`);
    }
    return conditions.join(' AND ');
  }
}

// ── PostgresAdapter ───────────────────────────────────────

export class PostgresAdapter {
  /**
   * @param {Pool|Client} client - node-postgres Pool or Client instance
   * @param {object} [opts]
   * @param {string} [opts.schema='public'] - PostgreSQL schema name
   */
  constructor(client, opts = {}) {
    this._client = client;
    this._schema = opts.schema ?? 'public';
  }

  async open(name, options = {}) {
    const version = options.version ?? 1;

    // Ensure metadata table exists
    await this._client.query(
      `CREATE TABLE IF NOT EXISTS "_easydb_meta" ("store" TEXT PRIMARY KEY, "key_path" TEXT, "auto_increment" BOOLEAN DEFAULT false, "indexes" TEXT DEFAULT '[]', "version" INTEGER DEFAULT 1)`
    );

    // Check current schema version
    const { rows: versionRows } = await this._client.query(
      `SELECT MAX("version") AS _v FROM "_easydb_meta"`
    );
    const currentVersion = versionRows[0]?._v || 0;

    if (currentVersion < version && options.schema) {
      const storeDefs = [];

      options.schema({
        createStore(storeName, opts = {}) {
          storeDefs.push({ storeName, opts });
        },
        getStore() { return null; }
      }, currentVersion);

      for (const { storeName, opts } of storeDefs) {
        const keyPath = opts.key || null;
        const autoIncrement = opts.autoIncrement || false;
        const indexes = [];

        const cols = [];
        if (keyPath) {
          cols.push(
            autoIncrement
              ? `${_esc(keyPath)} SERIAL PRIMARY KEY`
              : `${_esc(keyPath)} TEXT PRIMARY KEY`
          );
        }
        cols.push('"_value" TEXT NOT NULL');

        if (opts.indexes) {
          for (const idx of opts.indexes) {
            const n = typeof idx === 'string' ? idx : idx.name;
            const unique = typeof idx === 'string' ? false : (idx.unique || false);
            cols.push(`${_esc(n)} TEXT`);
            indexes.push({ name: n, unique });
          }
        }

        await this._client.query(
          `CREATE TABLE IF NOT EXISTS ${_esc(storeName)} (${cols.join(', ')})`
        );

        for (const idx of indexes) {
          const u = idx.unique ? 'UNIQUE ' : '';
          await this._client.query(
            `CREATE ${u}INDEX IF NOT EXISTS ${_esc('idx_' + storeName + '_' + idx.name)} ON ${_esc(storeName)}(${_esc(idx.name)})`
          );
        }

        await this._client.query(
          `INSERT INTO "_easydb_meta" ("store", "key_path", "auto_increment", "indexes", "version") VALUES ($1, $2, $3, $4, $5) ON CONFLICT("store") DO UPDATE SET "key_path" = $2, "auto_increment" = $3, "indexes" = $4, "version" = $5`,
          [storeName, keyPath, autoIncrement, JSON.stringify(indexes), version]
        );
      }
    }

    // Read all store metadata
    const { rows } = await this._client.query(
      `SELECT * FROM "_easydb_meta"`
    );

    const stores = new Map();
    for (const r of rows) {
      stores.set(r.store, {
        keyPath: r.key_path,
        autoIncrement: r.auto_increment,
        indexes: JSON.parse(r.indexes),
      });
    }

    return new PostgresConnection(name, this._client, stores, version);
  }

  async destroy(name) {
    try {
      const { rows } = await this._client.query(
        `SELECT "store" FROM "_easydb_meta"`
      );

      for (const r of rows) {
        await this._client.query(`DROP TABLE IF EXISTS ${_esc(r.store)}`);
      }
      await this._client.query(`DROP TABLE IF EXISTS "_easydb_meta"`);
    } catch (_) {
      // If _easydb_meta doesn't exist, nothing to destroy
    }
  }
}
