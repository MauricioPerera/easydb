/**
 * MySQL / MariaDB Adapter for EasyDB
 *
 * Maps EasyDB stores to MySQL tables. Each store becomes a table
 * with the keyPath as primary key, a _value column for the full JSON,
 * and additional columns for indexed fields.
 *
 * Works with both MySQL 8+ and MariaDB 10.5+ via the mysql2 driver.
 * Just pass a mysql2/promise Pool instance.
 *
 * Usage:
 *   import EasyDB from '@rckflr/easydb';
 *   import { MySQLAdapter } from '@rckflr/easydb/adapters/mysql';
 *   import mysql from 'mysql2/promise';
 *
 *   const pool = mysql.createPool({ host: 'localhost', user: 'root', database: 'app' });
 *   const db = await EasyDB.open('app', {
 *     adapter: new MySQLAdapter(pool),
 *     schema(s) {
 *       s.createStore('users', { key: 'id', indexes: ['role'] });
 *     }
 *   });
 */

function _esc(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

// ── MySQLConnection ──────────────────────────────────────

class MySQLConnection {
  constructor(name, client, stores, version) {
    this._name = name;
    this._client = client;
    this._stores = stores; // Map<storeName, { keyPath, autoIncrement, indexes }>
    this._version = version;
    this._savepointId = 0;
    this._txConn = null; // dedicated connection during transaction()
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

  /**
   * Normalizes mysql2's [rows, fields] return to { rows }.
   * Routes through _txConn when inside a transaction.
   */
  async _query(sql, params = []) {
    const client = this._txConn || this._client;
    const [rows] = await client.query(sql, params);
    return { rows };
  }

  // ── Read ops ──

  async get(storeName, key) {
    const meta = this._meta(storeName);
    const { rows } = await this._query(
      `SELECT \`_value\` FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?`,
      [key]
    );
    return rows[0] ? JSON.parse(rows[0]._value) : undefined;
  }

  async getAll(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    let sql = `SELECT \`_value\` FROM ${_esc(storeName)}`;
    const params = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, params)}`;
    }

    sql += ` ORDER BY ${_esc(orderCol)} ASC`;

    if (opts.limit != null) {
      params.push(opts.limit);
      sql += ` LIMIT ?`;
    }

    const { rows } = await this._query(sql, params);
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

    const { rows } = await this._query(sql, params);
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
      placeholders.push('?');
    }

    cols.push('`_value`');
    params.push(JSON.stringify(value));
    placeholders.push('?');

    for (const idx of meta.indexes) {
      cols.push(_esc(idx.name));
      params.push(value[idx.name] ?? null);
      placeholders.push('?');
    }

    if (key != null && meta.keyPath) {
      // Upsert — ON DUPLICATE KEY UPDATE
      const updateCols = cols.filter(c => c !== _esc(meta.keyPath));
      const setClause = updateCols.map(c => `${c} = VALUES(${c})`).join(', ');

      await this._query(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON DUPLICATE KEY UPDATE ${setClause}`,
        params
      );
      return key;
    }

    if (meta.autoIncrement) {
      // Need insertId from the result, so call client.query() directly
      const client = this._txConn || this._client;
      const [result] = await client.query(
        `INSERT INTO ${_esc(storeName)} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        params
      );
      key = Number(result.insertId);

      // Back-patch the generated key into _value
      const updated = { ...value, [meta.keyPath]: key };
      await this._query(
        `UPDATE ${_esc(storeName)} SET \`_value\` = ? WHERE ${_esc(meta.keyPath)} = ?`,
        [JSON.stringify(updated), key]
      );
      return key;
    }

    throw new Error('EasyDB: Cannot put without keyPath or autoIncrement');
  }

  async delete(storeName, key) {
    const meta = this._meta(storeName);
    await this._query(
      `DELETE FROM ${_esc(storeName)} WHERE ${_esc(meta.keyPath)} = ?`,
      [key]
    );
  }

  async clear(storeName) {
    await this._query(`DELETE FROM ${_esc(storeName)}`);
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
    // Non-autoIncrement: batch within a savepoint (nests safely inside transaction())
    const sp = `easydb_putmany_${++this._savepointId}`;
    await this._query(`SAVEPOINT ${sp}`);
    try {
      const keys = [];
      for (const item of items) {
        keys.push(await this.put(storeName, item));
      }
      await this._query(`RELEASE SAVEPOINT ${sp}`);
      return keys;
    } catch (err) {
      await this._query(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw err;
    }
  }

  // ── Cursor (async generator) ──

  async *cursor(storeName, opts = {}) {
    const meta = this._meta(storeName);
    const orderCol = opts.index || meta.keyPath;
    const dir = opts.direction === 'prev' ? 'DESC' : 'ASC';

    let sql = `SELECT \`_value\` FROM ${_esc(storeName)}`;
    const params = [];

    if (opts.range) {
      sql += ` WHERE ${this._where(orderCol, opts.range, params)}`;
    }

    sql += ` ORDER BY ${_esc(orderCol)} ${dir}`;

    const { rows } = await this._query(sql, params);
    for (const row of rows) {
      yield JSON.parse(row._value);
    }
  }

  // ── Multi-store transaction ──

  async transaction(storeNames, fn) {
    // Acquire a dedicated connection so BEGIN/COMMIT run on the same connection
    const conn = await this._client.getConnection();
    this._txConn = conn;

    try {
      await conn.query('BEGIN');

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

      await fn(proxy);
      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      this._txConn = null;
      conn.release();
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

// ── MySQLAdapter ─────────────────────────────────────────

export class MySQLAdapter {
  /**
   * @param {Pool} client - mysql2/promise Pool instance
   * @param {object} [opts]
   */
  constructor(client, opts = {}) {
    this._client = client;
  }

  async open(name, options = {}) {
    const version = options.version ?? 1;

    // Ensure metadata table exists
    await this._client.query(
      'CREATE TABLE IF NOT EXISTS `_easydb_meta` (`store` VARCHAR(255) PRIMARY KEY, `key_path` VARCHAR(255), `auto_increment` TINYINT(1) DEFAULT 0, `indexes` TEXT DEFAULT \'[]\', `version` INT DEFAULT 1)'
    );

    // Check current schema version
    const [versionRows] = await this._client.query(
      'SELECT MAX(`version`) AS _v FROM `_easydb_meta`'
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
              ? `${_esc(keyPath)} INT NOT NULL AUTO_INCREMENT PRIMARY KEY`
              : `${_esc(keyPath)} VARCHAR(255) PRIMARY KEY`
          );
        }
        cols.push('`_value` LONGTEXT NOT NULL');

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

        // MySQL 8 doesn't support CREATE INDEX IF NOT EXISTS — catch errno 1061
        for (const idx of indexes) {
          const u = idx.unique ? 'UNIQUE ' : '';
          try {
            await this._client.query(
              `CREATE ${u}INDEX ${_esc('idx_' + storeName + '_' + idx.name)} ON ${_esc(storeName)}(${_esc(idx.name)}(255))`
            );
          } catch (err) {
            // 1061 = Duplicate key name (index already exists)
            if (err.errno !== 1061) throw err;
          }
        }

        // Upsert metadata
        await this._client.query(
          'INSERT INTO `_easydb_meta` (`store`, `key_path`, `auto_increment`, `indexes`, `version`) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `key_path` = VALUES(`key_path`), `auto_increment` = VALUES(`auto_increment`), `indexes` = VALUES(`indexes`), `version` = VALUES(`version`)',
          [storeName, keyPath, autoIncrement ? 1 : 0, JSON.stringify(indexes), version]
        );
      }
    }

    // Read all store metadata
    const [rows] = await this._client.query(
      'SELECT * FROM `_easydb_meta`'
    );

    const stores = new Map();
    for (const r of rows) {
      stores.set(r.store, {
        keyPath: r.key_path,
        autoIncrement: !!r.auto_increment,
        indexes: JSON.parse(r.indexes),
      });
    }

    return new MySQLConnection(name, this._client, stores, version);
  }

  async destroy(name) {
    try {
      const [rows] = await this._client.query(
        'SELECT `store` FROM `_easydb_meta`'
      );

      for (const r of rows) {
        await this._client.query(`DROP TABLE IF EXISTS ${_esc(r.store)}`);
      }
      await this._client.query('DROP TABLE IF EXISTS `_easydb_meta`');
    } catch (_) {
      // If _easydb_meta doesn't exist, nothing to destroy
    }
  }
}
