import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { SQLiteAdapter } from '../src/adapters/sqlite.js';

describe('SQLite Adapter (better-sqlite3)', () => {
  let db, name;
  const adapter = new SQLiteAdapter(':memory:');

  beforeEach(async () => {
    name = 'sqlite-test-' + Math.random().toString(36).slice(2);
    db = await EasyDB.open(name, {
      adapter,
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['role', { name: 'email', unique: true }] });
        b.createStore('tasks', { key: 'id', autoIncrement: true });
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD operations', () => {
    it('put and get a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'alice@test.com' });
      const user = await db.users.get(1);
      expect(user).toEqual({ id: 1, name: 'Alice', role: 'admin', email: 'alice@test.com' });
    });

    it('get returns undefined for missing keys', async () => {
      const user = await db.users.get(999);
      expect(user).toBeUndefined();
    });

    it('put updates existing records (upsert)', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'alice@test.com' });
      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin', email: 'alice@test.com' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Alice Updated');
    });

    it('delete removes a record', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.delete(1);
      const user = await db.users.get(1);
      expect(user).toBeUndefined();
    });

    it('clear removes all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
      await db.users.clear();
      const count = await db.users.count();
      expect(count).toBe(0);
    });

    it('getAll returns all records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
      await db.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'c@test.com' });
      const all = await db.users.getAll();
      expect(all).toHaveLength(3);
    });

    it('count returns the number of records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
      expect(await db.users.count()).toBe(2);
    });

    it('getMany returns multiple records', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
      const results = await db.users.getMany([1, 2, 999]);
      expect(results[0]).toEqual({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      expect(results[1]).toEqual({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
      expect(results[2]).toBeUndefined();
    });

    it('putMany inserts multiple records atomically', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' },
        { id: 2, name: 'Bob', role: 'member', email: 'b@test.com' },
        { id: 3, name: 'Charlie', role: 'admin', email: 'c@test.com' },
      ]);
      expect(await db.users.count()).toBe(3);
    });
  });

  describe('autoIncrement', () => {
    it('generates auto-incrementing keys', async () => {
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

    it('putMany with autoIncrement', async () => {
      const count = await db.tasks.putMany([
        { title: 'Task A' },
        { title: 'Task B' },
      ]);
      expect(count).toBe(2);
      expect(await db.tasks.count()).toBe(2);

      const task1 = await db.tasks.get(1);
      const task2 = await db.tasks.get(2);
      expect(task1.title).toBe('Task A');
      expect(task2.title).toBe('Task B');
    });
  });

  describe('Unique indexes', () => {
    it('rejects duplicate unique index values', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'same@test.com' });
      await expect(
        db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'same@test.com' })
      ).rejects.toThrow();
    });

    it('allows updating the same record with same unique value', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'alice@test.com' });
      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin', email: 'alice@test.com' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Alice Updated');
    });
  });

  describe('QueryBuilder', () => {
    beforeEach(async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
      await db.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'c@test.com' });
      await db.users.put({ id: 4, name: 'Diana', role: 'member', email: 'd@test.com' });
    });

    it('all().toArray() returns all records', async () => {
      const all = await db.users.all().toArray();
      expect(all).toHaveLength(4);
    });

    it('all().count() returns the count', async () => {
      const count = await db.users.all().count();
      expect(count).toBe(4);
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

    it('filter() applies JS-side filter', async () => {
      const admins = await db.users.all().filter(u => u.role === 'admin').toArray();
      expect(admins).toHaveLength(2);
      expect(admins.every(u => u.role === 'admin')).toBe(true);
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

  describe('Cursor', () => {
    it('iterates records via async iterator', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
      await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });

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

  describe('Transactions', () => {
    it('commits on success', async () => {
      await db.transaction(['users', 'tasks'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });
        await tx.tasks.put({ title: 'Task 1' });
      });
      expect(await db.users.get(1)).toBeDefined();
      expect(await db.tasks.get(1)).toBeDefined();
    });

    it('rolls back on error', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@test.com' });

      try {
        await db.transaction(['users'], async (tx) => {
          await tx.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@test.com' });
          throw new Error('abort');
        });
      } catch (_) {}

      expect(await db.users.get(2)).toBeUndefined();
      expect(await db.users.get(1)).toBeDefined();
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

    it('getKeyPath returns correct values', () => {
      expect(db._conn.getKeyPath('users')).toBe('id');
      expect(db._conn.getKeyPath('tasks')).toBe('id');
    });

    it('version is set correctly', () => {
      expect(db.version).toBe(1);
    });
  });
});
