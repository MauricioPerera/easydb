/**
 * Real MongoDB Integration Tests
 *
 * Requires a running MongoDB instance (see docker-compose.yml).
 * Tests are skipped gracefully when MongoDB is unavailable.
 */
import { describe, it, expect, afterEach, afterAll, beforeEach } from 'vitest';
import { EasyDB } from '../../src/easydb.js';
import { MongoAdapter } from '../../src/adapters/mongo.js';
import { tryMongo, standardSchema } from './helpers.js';

// Top-level check — skip all tests if MongoDB is unavailable
const mongo = await tryMongo();

afterAll(async () => {
  if (mongo) {
    await mongo.db.dropDatabase();
    await mongo.client.close();
  }
});

describe.skipIf(!mongo)('MongoDB: Real Integration', () => {
  let db;
  let prefix;

  beforeEach(async () => {
    prefix = `test_${Date.now()}_${Math.random().toString(36).slice(2)}_`;
    db = await EasyDB.open(`mongo_test`, {
      adapter: new MongoAdapter(mongo.db, { prefix }),
      schema: standardSchema,
    });
  });

  afterEach(async () => {
    if (db) {
      db.close();
      // Clean up collections with this prefix
      const collections = await mongo.db.listCollections().toArray();
      for (const col of collections) {
        if (col.name.startsWith(prefix)) {
          await mongo.db.collection(col.name).drop().catch(() => {});
        }
      }
    }
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

    it('putMany with autoIncrement', async () => {
      const count = await db.tasks.putMany([
        { title: 'Task A' },
        { title: 'Task B' },
      ]);
      expect(count).toBe(2);
      const t1 = await db.tasks.get(1);
      const t2 = await db.tasks.get(2);
      expect(t1.title).toBe('Task A');
      expect(t2.title).toBe('Task B');
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
    });

    it('all().page(n, size) paginates', async () => {
      const page1 = await db.users.all().page(1, 2).toArray();
      const page2 = await db.users.all().page(2, 2).toArray();
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });

    it('all().desc() reverses order', async () => {
      const desc = await db.users.all().desc().toArray();
      const ids = desc.map(u => u.id);
      expect(ids[0]).toBeGreaterThan(ids[ids.length - 1]);
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
    it('preserves strings', async () => {
      await db.users.put({ id: 1, name: 'Hello World', role: 'test', email: 'str@t.com' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Hello World');
    });

    it('preserves numbers (int and float)', async () => {
      await db.tasks.put({ id: 1, count: 42, ratio: 3.14 });
      const task = await db.tasks.get(1);
      expect(task.count).toBe(42);
      expect(task.ratio).toBeCloseTo(3.14);
    });

    it('preserves booleans', async () => {
      await db.tasks.put({ id: 1, active: true, deleted: false });
      const task = await db.tasks.get(1);
      expect(task.active).toBe(true);
      expect(task.deleted).toBe(false);
    });

    it('preserves null', async () => {
      await db.tasks.put({ id: 1, value: null });
      const task = await db.tasks.get(1);
      expect(task.value).toBeNull();
    });

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

  // ── Edge cases ────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty store gracefully', async () => {
      expect(await db.users.getAll()).toEqual([]);
      expect(await db.users.count()).toBe(0);
      const first = await db.users.all().first();
      expect(first).toBeUndefined();
    });

    it('delete on missing key does not throw', async () => {
      await expect(db.users.delete(999)).resolves.not.toThrow();
    });

    it('getMany with empty array returns empty array', async () => {
      const results = await db.users.getMany([]);
      expect(results).toEqual([]);
    });

    it('putMany with empty array returns 0', async () => {
      const count = await db.users.putMany([]);
      expect(count).toBe(0);
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

    it('emits delete events', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

      const watcher = db.users.watch()[Symbol.asyncIterator]();
      await db.users.delete(1);

      const { value } = await watcher.next();
      expect(value.type).toBe('delete');
      expect(value.key).toBe(1);

      if (watcher.return) watcher.return();
    });
  });
});
