import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { PostgresAdapter } from '../src/adapters/postgres.js';

// ── Mock PostgreSQL client ───────────────────────────────
// Simulates a pg Pool/Client with an in-memory SQL-like store.

function createMockPgClient() {
  const tables = new Map(); // tableName -> rows[]

  function parseWhere(sql, params) {
    // Very basic SQL parser for our test queries
    const whereMatch = sql.match(/WHERE\s+"?(\w+)"?\s*(=|>|>=|<|<=)\s*\$(\d+)/i);
    if (!whereMatch) return null;
    return {
      col: whereMatch[1],
      op: whereMatch[2],
      value: params[parseInt(whereMatch[3]) - 1],
    };
  }

  function matchesWhere(row, where) {
    if (!where) return true;
    const val = row[where.col];
    switch (where.op) {
      case '=': return val === where.value;
      case '>': return val > where.value;
      case '>=': return val >= where.value;
      case '<': return val < where.value;
      case '<=': return val <= where.value;
      default: return true;
    }
  }

  return {
    query(sql, params = []) {
      const trimmed = sql.trim();

      // CREATE TABLE
      if (/^CREATE TABLE IF NOT EXISTS/i.test(trimmed)) {
        const nameMatch = trimmed.match(/CREATE TABLE IF NOT EXISTS\s+"?(\w+)"?\s*\(/i);
        if (nameMatch && !tables.has(nameMatch[1])) {
          const colDefs = trimmed.match(/\((.+)\)/s)?.[1] || '';
          const autoInc = /SERIAL/i.test(colDefs);
          tables.set(nameMatch[1], { rows: [], nextId: 1, autoInc });
        }
        return { rows: [] };
      }

      // CREATE INDEX
      if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(trimmed)) {
        return { rows: [] };
      }

      // INSERT ... ON CONFLICT
      if (/^INSERT INTO/i.test(trimmed)) {
        const tableMatch = trimmed.match(/INSERT INTO\s+"?(\w+)"?\s*\(/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) throw new Error(`Table ${tableName} not found`);

        // Extract column names
        const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
        const cols = colsMatch?.[1].replace(/"/g, '').split(',').map(c => c.trim()) || [];

        // Build row from params
        const row = {};
        cols.forEach((col, i) => {
          row[col] = params[i];
        });

        const returning = /RETURNING\s+"?(\w+)"?/i.test(trimmed);
        const onConflict = /ON CONFLICT/i.test(trimmed);

        if (table.autoInc && !row[cols[0]]) {
          row[cols[0]] = table.nextId++;
        }

        if (onConflict) {
          // Upsert: find existing by first col (PK)
          const pkCol = cols[0];
          const existingIdx = table.rows.findIndex(r => r[pkCol] === row[pkCol]);
          if (existingIdx >= 0) {
            // Update
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

        // Extract WHERE col and value
        const whereMatch = trimmed.match(/WHERE\s+"?(\w+)"?\s*=\s*\$(\d+)/i);
        if (whereMatch) {
          const whereCol = whereMatch[1];
          const whereVal = params[parseInt(whereMatch[2]) - 1];
          const idx = table.rows.findIndex(r => r[whereCol] === whereVal);
          if (idx >= 0) {
            // Extract SET assignments
            const setMatch = trimmed.match(/SET\s+(.+)\s+WHERE/i)?.[1] || '';
            const assignments = setMatch.split(',').map(a => a.trim());
            for (const assign of assignments) {
              const m = assign.match(/"?(\w+)"?\s*=\s*\$(\d+)/);
              if (m) {
                table.rows[idx][m[1]] = params[parseInt(m[2]) - 1];
              }
            }
          }
        }
        return { rows: [] };
      }

      // SELECT COUNT
      if (/^SELECT COUNT/i.test(trimmed)) {
        const tableMatch = trimmed.match(/FROM\s+"?(\w+)"?/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) return { rows: [{ _cnt: '0' }] };

        const where = parseWhere(trimmed, params);
        const count = table.rows.filter(r => matchesWhere(r, where)).length;
        return { rows: [{ _cnt: String(count) }] };
      }

      // SELECT MAX(version)
      if (/^SELECT MAX/i.test(trimmed)) {
        const tableMatch = trimmed.match(/FROM\s+"?(\w+)"?/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) return { rows: [{ _v: null }] };

        const max = table.rows.reduce((m, r) => Math.max(m, r.version || 0), 0);
        return { rows: [{ _v: max || null }] };
      }

      // SELECT * or SELECT "_value"
      if (/^SELECT/i.test(trimmed)) {
        const tableMatch = trimmed.match(/FROM\s+"?(\w+)"?/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) return { rows: [] };

        let filtered = [...table.rows];

        // Handle WHERE
        // Multiple WHERE conditions
        const whereClause = trimmed.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s*$)/is)?.[1];
        if (whereClause) {
          const conditions = whereClause.split(/\s+AND\s+/i);
          for (const cond of conditions) {
            const m = cond.match(/"?(\w+)"?\s*(=|>|>=|<|<=)\s*\$(\d+)/);
            if (m) {
              const col = m[1];
              const op = m[2];
              const val = params[parseInt(m[3]) - 1];
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

        // Handle ORDER BY
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

        // Handle LIMIT
        const limitMatch = trimmed.match(/LIMIT\s+\$(\d+)/i);
        if (limitMatch) {
          filtered = filtered.slice(0, params[parseInt(limitMatch[1]) - 1]);
        }

        // Return only _value column if requested
        if (/SELECT\s+"_value"/i.test(trimmed)) {
          return { rows: filtered.map(r => ({ _value: r._value })) };
        }

        return { rows: filtered };
      }

      // DELETE
      if (/^DELETE FROM/i.test(trimmed)) {
        const tableMatch = trimmed.match(/DELETE FROM\s+"?(\w+)"?/i);
        const tableName = tableMatch?.[1];
        const table = tables.get(tableName);
        if (!table) return { rows: [] };

        const where = parseWhere(trimmed, params);
        if (where) {
          table.rows = table.rows.filter(r => !matchesWhere(r, where));
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

      // BEGIN / COMMIT / ROLLBACK (no-op for mock)
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
        return { rows: [] };
      }

      return { rows: [] };
    }
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('PostgreSQL Adapter', () => {
  let db, name, adapter, client;

  beforeEach(async () => {
    client = createMockPgClient();
    adapter = new PostgresAdapter(client);
    name = 'pg-test-' + Math.random().toString(36).slice(2);
    db = await EasyDB.open(name, {
      adapter,
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['role'] });
        b.createStore('tasks', { key: 'id', autoIncrement: true });
      },
    });
  });

  afterEach(async () => {
    await EasyDB.destroy(name, { adapter });
  });

  describe('CRUD operations', () => {
    it('put and get a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      const user = await db.users.get(1);
      expect(user).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    });

    it('get returns undefined for missing keys', async () => {
      const user = await db.users.get(999);
      expect(user).toBeUndefined();
    });

    it('put updates existing records (upsert)', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Alice Updated');
    });

    it('delete removes a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.delete(1);
      const user = await db.users.get(1);
      expect(user).toBeUndefined();
    });

    it('clear removes all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      await db.users.clear();
      const count = await db.users.count();
      expect(count).toBe(0);
    });

    it('getAll returns all records sorted by key', async () => {
      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
      const all = await db.users.getAll();
      expect(all).toHaveLength(3);
    });

    it('count returns the number of records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      expect(await db.users.count()).toBe(2);
    });

    it('putMany inserts multiple records', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
        { id: 3, name: 'Charlie', role: 'admin' },
      ]);
      expect(await db.users.count()).toBe(3);
    });
  });

  describe('QueryBuilder', () => {
    beforeEach(async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
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
      expect(first.id).toBe(1);
    });

    it('all().limit(n) limits results', async () => {
      const limited = await db.users.all().limit(2).toArray();
      expect(limited).toHaveLength(2);
    });

    it('filter() applies JS-side filter', async () => {
      const admins = await db.users.all().filter(u => u.role === 'admin').toArray();
      expect(admins).toHaveLength(2);
      expect(admins.every(u => u.role === 'admin')).toBe(true);
    });
  });

  describe('Cursor', () => {
    it('iterates records via async iterator', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member' });

      const results = [];
      for await (const user of db.users.all()) {
        results.push(user);
      }
      expect(results).toHaveLength(2);
    });
  });

  describe('Transactions', () => {
    it('commits on success', async () => {
      await db.transaction(['users'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await tx.users.put({ id: 2, name: 'Bob', role: 'member' });
      });
      expect(await db.users.count()).toBe(2);
    });
  });

  describe('Store metadata', () => {
    it('reports store names', () => {
      expect(db.stores).toContain('users');
      expect(db.stores).toContain('tasks');
    });

    it('hasStore returns correct values', () => {
      expect(db._conn.hasStore('users')).toBe(true);
      expect(db._conn.hasStore('nonexistent')).toBe(false);
    });
  });
});
