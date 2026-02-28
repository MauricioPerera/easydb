import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { TursoAdapter } from '../src/adapters/turso.js';

// ── Mock libSQL client ────────────────────────────────────
// Simulates @libsql/client with in-memory SQL-like store.

function createMockLibSQLClient() {
  const tables = new Map(); // tableName -> { rows[], nextId, autoInc }

  function parseConditions(sql, args) {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s*$)/is);
    if (!whereMatch) return null;

    const conditions = whereMatch[1].split(/\s+AND\s+/i);
    return conditions.map(cond => {
      const m = cond.match(/"?(\w+)"?\s*(=|>|>=|<|<=)\s*\?/);
      if (!m) return null;
      return { col: m[1], op: m[2] };
    }).filter(Boolean);
  }

  function matchesConditions(row, conditions, args, startIdx = 0) {
    if (!conditions) return true;
    let idx = startIdx;
    for (const cond of conditions) {
      const val = args[idx++];
      const rv = row[cond.col];
      switch (cond.op) {
        case '=': if (rv !== val) return false; break;
        case '>': if (rv <= val) return false; break;
        case '>=': if (rv < val) return false; break;
        case '<': if (rv >= val) return false; break;
        case '<=': if (rv > val) return false; break;
      }
    }
    return true;
  }

  const client = {
    async execute({ sql, args = [] }) {
      const trimmed = sql.trim();

      // CREATE TABLE
      if (/^CREATE TABLE IF NOT EXISTS/i.test(trimmed)) {
        const nameMatch = trimmed.match(/CREATE TABLE IF NOT EXISTS\s+"?(\w+)"?\s*\(/i);
        if (nameMatch && !tables.has(nameMatch[1])) {
          const autoInc = /AUTOINCREMENT/i.test(trimmed);
          // Extract PK column name
          const pkMatch = trimmed.match(/"(\w+)"\s+(?:INTEGER\s+)?PRIMARY KEY/i);
          const pkCol = pkMatch ? pkMatch[1] : null;
          tables.set(nameMatch[1], { rows: [], nextId: 1, autoInc, pkCol });
        }
        return { rows: [] };
      }

      // CREATE INDEX
      if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(trimmed)) {
        return { rows: [] };
      }

      // INSERT OR REPLACE
      if (/^INSERT OR REPLACE/i.test(trimmed)) {
        const tableMatch = trimmed.match(/INTO\s+"?(\w+)"?\s*\(/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) throw new Error(`Table ${tableName} not found`);

        const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
        const cols = colsMatch?.[1].replace(/"/g, '').split(',').map(c => c.trim()) || [];

        const row = {};
        cols.forEach((col, i) => { row[col] = args[i]; });

        // Replace if exists
        const pkCol = cols[0];
        const existingIdx = table.rows.findIndex(r => r[pkCol] === row[pkCol]);
        if (existingIdx >= 0) {
          table.rows[existingIdx] = row;
        } else {
          table.rows.push(row);
        }
        return { rows: [] };
      }

      // INSERT ... ON CONFLICT
      if (/^INSERT INTO/i.test(trimmed)) {
        const tableMatch = trimmed.match(/INSERT INTO\s+"?(\w+)"?\s*\(/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) throw new Error(`Table ${tableName} not found`);

        const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
        const cols = colsMatch?.[1].replace(/"/g, '').split(',').map(c => c.trim()) || [];

        const row = {};
        cols.forEach((col, i) => { row[col] = args[i]; });

        const returning = /RETURNING\s+"?(\w+)"?/i.test(trimmed);
        const onConflict = /ON CONFLICT/i.test(trimmed);

        // AutoIncrement: generate key if PK column is missing or null
        if (table.autoInc && table.pkCol && row[table.pkCol] == null) {
          row[table.pkCol] = table.nextId++;
        }

        if (onConflict) {
          const pkCol = table.pkCol || cols[0];
          const existingIdx = table.rows.findIndex(r => r[pkCol] === row[pkCol]);
          if (existingIdx >= 0) {
            table.rows[existingIdx] = { ...table.rows[existingIdx], ...row };
          } else {
            table.rows.push(row);
          }
        } else {
          table.rows.push(row);
        }

        if (returning) {
          const retCol = trimmed.match(/RETURNING\s+"?(\w+)"?/i)?.[1];
          return { rows: [{ [retCol]: row[retCol] }] };
        }

        return { rows: [] };
      }

      // UPDATE
      if (/^UPDATE/i.test(trimmed)) {
        const tableMatch = trimmed.match(/UPDATE\s+"?(\w+)"?\s+SET/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) return { rows: [] };

        // Find the WHERE value (last arg)
        const whereVal = args[args.length - 1];
        const whereColMatch = trimmed.match(/WHERE\s+"?(\w+)"?\s*=\s*\?/i);
        if (whereColMatch) {
          const whereCol = whereColMatch[1];
          const idx = table.rows.findIndex(r => r[whereCol] === whereVal);
          if (idx >= 0) {
            // Parse SET clauses
            const setMatch = trimmed.match(/SET\s+(.+)\s+WHERE/i)?.[1] || '';
            const assignments = setMatch.split(',').map(a => a.trim());
            let argIdx = 0;
            for (const assign of assignments) {
              const m = assign.match(/"?(\w+)"?\s*=\s*\?/);
              if (m) {
                table.rows[idx][m[1]] = args[argIdx];
              }
              argIdx++;
            }
          }
        }
        return { rows: [] };
      }

      // SELECT COUNT
      if (/^SELECT COUNT/i.test(trimmed)) {
        const tableMatch = trimmed.match(/FROM\s+"?(\w+)"?/i);
        const table = tables.get(tableMatch?.[1]);
        if (!table) return { rows: [{ _cnt: 0 }] };

        const conditions = parseConditions(trimmed, args);
        let count = 0;
        let argIdx = 0;
        for (const row of table.rows) {
          if (matchesConditions(row, conditions, args, 0)) count++;
        }
        return { rows: [{ _cnt: count }] };
      }

      // SELECT MAX
      if (/^SELECT MAX/i.test(trimmed)) {
        const tableMatch = trimmed.match(/FROM\s+"?(\w+)"?/i);
        const table = tables.get(tableMatch?.[1]);
        if (!table) return { rows: [{ _v: null }] };
        const max = table.rows.reduce((m, r) => Math.max(m, r.version || 0), 0);
        return { rows: [{ _v: max || null }] };
      }

      // SELECT
      if (/^SELECT/i.test(trimmed)) {
        const tableMatch = trimmed.match(/FROM\s+"?(\w+)"?/i);
        const table = tables.get(tableMatch?.[1]);
        if (!table) return { rows: [] };

        let filtered = [...table.rows];

        // WHERE
        const whereClause = trimmed.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s*$)/is)?.[1];
        if (whereClause) {
          const conditions = whereClause.split(/\s+AND\s+/i);
          let argIdx = 0;
          for (const cond of conditions) {
            const m = cond.match(/"?(\w+)"?\s*(=|>|>=|<|<=)\s*\?/);
            if (m) {
              const col = m[1];
              const op = m[2];
              const val = args[argIdx++];
              filtered = filtered.filter(r => {
                const rv = r[col];
                switch (op) {
                  case '=': return rv === val;
                  case '>': return rv > val;
                  case '>=': return rv >= val;
                  case '<': return rv < val;
                  case '<=': return rv <= val;
                }
                return true;
              });
            }
          }
        }

        // ORDER BY
        const orderMatch = trimmed.match(/ORDER BY\s+"?(\w+)"?\s*(ASC|DESC)?/i);
        if (orderMatch) {
          const orderCol = orderMatch[1];
          const desc = orderMatch[2]?.toUpperCase() === 'DESC';
          filtered.sort((a, b) => {
            if (a[orderCol] < b[orderCol]) return desc ? 1 : -1;
            if (a[orderCol] > b[orderCol]) return desc ? -1 : 1;
            return 0;
          });
        }

        // LIMIT
        if (/LIMIT\s+\?/i.test(trimmed)) {
          const limitArgIdx = args.length - 1;
          filtered = filtered.slice(0, args[limitArgIdx]);
        }

        // Return specific columns
        if (/SELECT\s+"_value"/i.test(trimmed)) {
          return { rows: filtered.map(r => ({ _value: r._value })) };
        }

        return { rows: filtered };
      }

      // DELETE
      if (/^DELETE FROM/i.test(trimmed)) {
        const tableMatch = trimmed.match(/DELETE FROM\s+"?(\w+)"?/i);
        const table = tables.get(tableMatch?.[1]);
        if (!table) return { rows: [] };

        const whereColMatch = trimmed.match(/WHERE\s+"?(\w+)"?\s*=\s*\?/i);
        if (whereColMatch && args.length > 0) {
          const col = whereColMatch[1];
          const val = args[0];
          table.rows = table.rows.filter(r => r[col] !== val);
        } else {
          table.rows = [];
        }
        return { rows: [] };
      }

      // DROP TABLE
      if (/^DROP TABLE/i.test(trimmed)) {
        const nameMatch = trimmed.match(/DROP TABLE IF EXISTS\s+"?(\w+)"?/i);
        if (nameMatch) tables.delete(nameMatch[1]);
        return { rows: [] };
      }

      return { rows: [] };
    },

    async batch(stmts) {
      const results = [];
      for (const stmt of stmts) {
        results.push(await client.execute(stmt));
      }
      return results;
    },
  };

  return client;
}

// ── Tests ─────────────────────────────────────────────────

describe('Turso/libSQL Adapter', () => {
  let db, name, adapter, libsqlClient;

  beforeEach(async () => {
    libsqlClient = createMockLibSQLClient();
    adapter = new TursoAdapter(libsqlClient);
    name = 'turso-test-' + Math.random().toString(36).slice(2);
    db = await EasyDB.open(name, {
      adapter,
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['email'] });
        b.createStore('posts', { key: 'id', autoIncrement: true });
      },
    });
  });

  afterEach(async () => {
    await EasyDB.destroy(name, { adapter });
  });

  describe('CRUD operations', () => {
    it('put and get a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'alice@test.com' });
      const user = await db.users.get(1);
      expect(user).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' });
    });

    it('get returns undefined for missing keys', async () => {
      const user = await db.users.get(999);
      expect(user).toBeUndefined();
    });

    it('put updates existing records (upsert)', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'alice@test.com' });
      await db.users.put({ id: 1, name: 'Alice Updated', email: 'alice@test.com' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Alice Updated');
    });

    it('delete removes a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'alice@test.com' });
      await db.users.delete(1);
      const user = await db.users.get(1);
      expect(user).toBeUndefined();
    });

    it('clear removes all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', email: 'b@test.com' });
      await db.users.clear();
      const count = await db.users.count();
      expect(count).toBe(0);
    });

    it('getAll returns all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', email: 'b@test.com' });
      await db.users.put({ id: 3, name: 'Charlie', email: 'c@test.com' });
      const all = await db.users.getAll();
      expect(all).toHaveLength(3);
    });

    it('count returns the number of records', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', email: 'b@test.com' });
      expect(await db.users.count()).toBe(2);
    });

    it('putMany inserts multiple records', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', email: 'a@test.com' },
        { id: 2, name: 'Bob', email: 'b@test.com' },
        { id: 3, name: 'Charlie', email: 'c@test.com' },
      ]);
      expect(await db.users.count()).toBe(3);
    });
  });

  describe('autoIncrement', () => {
    it('generates auto-incrementing keys', async () => {
      const k1 = await db.posts.put({ title: 'Post 1' });
      const k2 = await db.posts.put({ title: 'Post 2' });
      expect(k1).toBe(1);
      expect(k2).toBe(2);
    });

    it('assigns generated key to the record', async () => {
      await db.posts.put({ title: 'Post 1' });
      const post = await db.posts.get(1);
      expect(post.id).toBe(1);
      expect(post.title).toBe('Post 1');
    });
  });

  describe('QueryBuilder', () => {
    beforeEach(async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'alice@test.com' });
      await db.users.put({ id: 2, name: 'Bob', email: 'bob@test.com' });
      await db.users.put({ id: 3, name: 'Charlie', email: 'charlie@test.com' });
    });

    it('all().toArray() returns all records', async () => {
      const all = await db.users.all().toArray();
      expect(all).toHaveLength(3);
    });

    it('all().count() returns the count', async () => {
      const count = await db.users.all().count();
      expect(count).toBe(3);
    });

    it('all().first() returns the first record', async () => {
      const first = await db.users.all().first();
      expect(first).toBeDefined();
    });

    it('all().limit(n) limits results', async () => {
      const limited = await db.users.all().limit(2).toArray();
      expect(limited).toHaveLength(2);
    });

    it('filter() applies JS-side filter', async () => {
      const filtered = await db.users.all()
        .filter(u => u.name.startsWith('A'))
        .toArray();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Alice');
    });
  });

  describe('Cursor', () => {
    it('iterates records via async iterator', async () => {
      await db.users.put({ id: 1, name: 'Alice', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', email: 'b@test.com' });

      const results = [];
      for await (const user of db.users.all()) {
        results.push(user);
      }
      expect(results).toHaveLength(2);
    });
  });

  describe('Store metadata', () => {
    it('reports store names', () => {
      expect(db.stores).toContain('users');
      expect(db.stores).toContain('posts');
    });

    it('hasStore returns correct values', () => {
      expect(db._conn.hasStore('users')).toBe(true);
      expect(db._conn.hasStore('nonexistent')).toBe(false);
    });

    it('getKeyPath returns correct values', () => {
      expect(db._conn.getKeyPath('users')).toBe('id');
    });
  });
});
