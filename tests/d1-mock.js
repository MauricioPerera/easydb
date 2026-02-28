/**
 * D1 API Mock using better-sqlite3
 *
 * Wraps better-sqlite3's synchronous SQLite API to match
 * Cloudflare D1's async interface: prepare().bind().run()/first()/all()
 * and batch() for atomic multi-statement execution.
 *
 * Converts D1-style numbered placeholders (?1, ?2, ...) to
 * better-sqlite3's anonymous placeholders (?).
 */
import Database from 'better-sqlite3';

function convertSQL(sql) {
  // Replace ?N with ? — params are already ordered by bind()
  return sql.replace(/\?(\d+)/g, '?');
}

class MockD1Statement {
  constructor(db, sql) {
    this._db = db;
    this._sql = convertSQL(sql);
    this._rawSql = sql;
    this._params = [];
  }

  bind(...params) {
    this._params = params;
    return this;
  }

  async run() {
    const stmt = this._db.prepare(this._sql);
    const info = stmt.run(...this._params);
    return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
  }

  async first(col) {
    const stmt = this._db.prepare(this._sql);
    const row = stmt.get(...this._params);
    if (!row) return null;
    if (col) return row[col];
    return row;
  }

  async all() {
    const stmt = this._db.prepare(this._sql);
    const rows = stmt.all(...this._params);
    return { success: true, results: rows };
  }
}

export class MockD1Database {
  constructor() {
    this._db = new Database(':memory:');
  }

  prepare(sql) {
    return new MockD1Statement(this._db, sql);
  }

  async batch(stmts) {
    // D1 batch() is atomic — execute all in a transaction
    const results = [];
    const transaction = this._db.transaction(() => {
      for (const stmt of stmts) {
        const s = this._db.prepare(stmt._sql);
        const info = s.run(...stmt._params);
        results.push({ success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } });
      }
    });
    transaction();
    return results;
  }

  close() {
    this._db.close();
  }
}
