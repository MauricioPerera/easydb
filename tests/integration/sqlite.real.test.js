/**
 * Real SQLite Integration Tests (file-based persistence)
 *
 * Uses better-sqlite3 with a temp file to verify persistence across
 * close/reopen cycles — unlike conformance tests which use :memory:.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { EasyDB } from '../../src/easydb.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite.js';
import { standardSchema } from './helpers.js';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(tmpdir(), `easydb_integration_${Date.now()}.db`);

afterAll(() => {
  // Clean up temp file
  for (const ext of ['', '-wal', '-shm']) {
    const f = dbPath + ext;
    if (existsSync(f)) unlinkSync(f);
  }
});

describe('SQLite: Real Integration (file-based)', () => {
  let db;

  beforeEach(async () => {
    // Remove previous file for fresh state
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (existsSync(f)) unlinkSync(f);
    }
    db = await EasyDB.open('sqlite_test', {
      adapter: new SQLiteAdapter(dbPath),
      schema: standardSchema,
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  // ── CRUD ──────────────────────────────────────────────
  describe('CRUD', () => {
    it('put and get a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      const user = await db.users.get(1);
      expect(user).toEqual({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
    });

    it('get returns undefined for missing keys', async () => {
      expect(await db.users.get(999)).toBeUndefined();
    });

    it('put updates existing records (upsert)', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 1, name: 'Updated', role: 'admin', email: 'a@t.com' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Updated');
    });

    it('delete removes a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.delete(1);
      expect(await db.users.get(1)).toBeUndefined();
    });

    it('clear removes all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      await db.users.clear();
      expect(await db.users.count()).toBe(0);
    });

    it('getAll returns all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      await db.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'c@t.com' });
      const all = await db.users.getAll();
      expect(all).toHaveLength(3);
    });

    it('count returns the number of records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      expect(await db.users.count()).toBe(2);
    });

    it('getMany returns multiple records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      const results = await db.users.getMany([1, 2, 999]);
      expect(results[0]).toEqual({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      expect(results[1]).toEqual({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      expect(results[2]).toBeUndefined();
    });

    it('putMany inserts multiple records', async () => {
      const count = await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' },
        { id: 2, name: 'Bob', role: 'member', email: 'b@t.com' },
        { id: 3, name: 'Charlie', role: 'admin', email: 'c@t.com' },
      ]);
      expect(count).toBe(3);
      expect(await db.users.count()).toBe(3);
    });
  });

  // ── File persistence ─────────────────────────────────
  describe('file persistence', () => {
    it('data survives close and reopen', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      db.close();

      // Reopen the same file
      const db2 = await EasyDB.open('sqlite_test', {
        adapter: new SQLiteAdapter(dbPath),
        schema: standardSchema,
      });

      expect(await db2.users.count()).toBe(2);
      const alice = await db2.users.get(1);
      expect(alice.name).toBe('Alice');

      db2.close();
      // Reassign so afterEach doesn't try to close again
      db = null;
    });
  });

  // ── AutoIncrement ─────────────────────────────────────
  describe('autoIncrement', () => {
    it('generates sequential keys', async () => {
      const k1 = await db.tasks.put({ title: 'Task 1' });
      const k2 = await db.tasks.put({ title: 'Task 2' });
      const k3 = await db.tasks.put({ title: 'Task 3' });
      expect(k1).toBe(1);
      expect(k2).toBe(2);
      expect(k3).toBe(3);
    });

    it('assigns generated key to the record', async () => {
      await db.tasks.put({ title: 'Task 1' });
      const task = await db.tasks.get(1);
      expect(task.id).toBe(1);
      expect(task.title).toBe('Task 1');
    });
  });

  // ── Unique indexes ────────────────────────────────────
  describe('unique indexes', () => {
    it('rejects duplicate unique index values', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'same@t.com' });
      await expect(
        db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'same@t.com' })
      ).rejects.toThrow();
    });

    it('allows updating same record with same unique value', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin', email: 'a@t.com' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Alice Updated');
    });
  });

  // ── QueryBuilder ──────────────────────────────────────
  describe('QueryBuilder', () => {
    beforeEach(async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
      await db.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'c@t.com' });
      await db.users.put({ id: 4, name: 'Diana', role: 'member', email: 'd@t.com' });
    });

    it('all().toArray() returns all records', async () => {
      const all = await db.users.all().toArray();
      expect(all).toHaveLength(4);
    });

    it('all().count() returns the count', async () => {
      expect(await db.users.all().count()).toBe(4);
    });

    it('all().first() returns the first record', async () => {
      const first = await db.users.all().first();
      expect(first.id).toBe(1);
    });

    it('all().limit(n) limits results', async () => {
      const limited = await db.users.all().limit(2).toArray();
      expect(limited).toHaveLength(2);
    });

    it('all().skip(n) skips results', async () => {
      const skipped = await db.users.all().skip(2).toArray();
      expect(skipped).toHaveLength(2);
      expect(skipped[0].id).toBe(3);
    });

    it('all().page(n, size) paginates', async () => {
      const page1 = await db.users.all().page(1, 2).toArray();
      const page2 = await db.users.all().page(2, 2).toArray();
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).toBe(1);
      expect(page2[0].id).toBe(3);
    });

    it('all().desc() reverses order', async () => {
      const desc = await db.users.all().desc().toArray();
      expect(desc[0].id).toBe(4);
      expect(desc[desc.length - 1].id).toBe(1);
    });

    it('where() with index filters by value', async () => {
      const admins = await db.users.where('role', 'admin').toArray();
      expect(admins).toHaveLength(2);
    });

    it('where().gt() range query', async () => {
      const result = await db.users.where('id').gt(2).toArray();
      expect(result).toHaveLength(2);
      expect(result.every(u => u.id > 2)).toBe(true);
    });

    it('where().between() range query', async () => {
      const result = await db.users.where('id').between(2, 3).toArray();
      expect(result).toHaveLength(2);
    });
  });

  // ── Cursor (async iterator) ───────────────────────────
  describe('cursor', () => {
    it('iterates records via async iterator', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });

      const results = [];
      for await (const user of db.users.all()) {
        results.push(user);
      }
      expect(results).toHaveLength(2);
    });

    it('supports early break', async () => {
      await db.users.putMany([
        { id: 1, name: 'A', role: 'a', email: 'a@t.com' },
        { id: 2, name: 'B', role: 'b', email: 'b@t.com' },
        { id: 3, name: 'C', role: 'c', email: 'c@t.com' },
      ]);

      const results = [];
      for await (const user of db.users.all()) {
        results.push(user);
        if (results.length === 2) break;
      }
      expect(results).toHaveLength(2);
    });
  });

  // ── Transactions ──────────────────────────────────────
  describe('transactions', () => {
    it('commits on success', async () => {
      await db.transaction(['users', 'tasks'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await tx.tasks.put({ title: 'Task 1' });
      });
      expect(await db.users.get(1)).toBeDefined();
      expect(await db.tasks.get(1)).toBeDefined();
    });

    it('rolls back on error', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

      try {
        await db.transaction(['users'], async (tx) => {
          await tx.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
          throw new Error('abort');
        });
      } catch (_) {}

      expect(await db.users.get(2)).toBeUndefined();
      expect(await db.users.get(1)).toBeDefined();
    });
  });

  // ── Data type preservation ───────────────────────────
  describe('data type preservation', () => {
    it('preserves nested objects', async () => {
      const nested = { id: 1, meta: { tags: ['a', 'b'], info: { level: 3 } }, role: 'x', email: 'n@t.com' };
      await db.users.put(nested);
      const user = await db.users.get(1);
      expect(user.meta).toEqual({ tags: ['a', 'b'], info: { level: 3 } });
    });

    it('preserves arrays', async () => {
      await db.tasks.put({ id: 1, items: [1, 'two', { three: 3 }] });
      const task = await db.tasks.get(1);
      expect(task.items).toEqual([1, 'two', { three: 3 }]);
    });
  });

  // ── Watch / Reactivity ────────────────────────────────
  describe('watch', () => {
    it('emits put events', async () => {
      const watcher = db.users.watch()[Symbol.asyncIterator]();

      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

      const { value } = await watcher.next();
      expect(value.type).toBe('put');
      expect(value.key).toBe(1);

      if (watcher.return) watcher.return();
    });
  });
});
