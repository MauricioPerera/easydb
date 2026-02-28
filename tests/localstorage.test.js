import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { LocalStorageAdapter } from '../src/adapters/localstorage.js';

// Mock localStorage for Node.js environment
const storage = new Map();
const localStorageMock = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() { return storage.size; },
  clear: () => storage.clear(),
};

// Install mock before importing
globalThis.localStorage = localStorageMock;

describe('LocalStorage Adapter', () => {
  let db, name;
  const adapter = new LocalStorageAdapter();

  beforeEach(async () => {
    storage.clear();
    name = 'ls-test-' + Math.random().toString(36).slice(2);
    db = await EasyDB.open(name, {
      adapter,
      schema(b) {
        b.createStore('users', { key: 'id' });
        b.createStore('tasks', { key: 'id', autoIncrement: true });
      },
    });
  });

  afterEach(async () => {
    await EasyDB.destroy(name, { adapter });
  });

  describe('CRUD operations', () => {
    it('put and get a record', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      const user = await db.users.get(1);
      expect(user).toEqual({ id: 1, name: 'Alice' });
    });

    it('get returns undefined for missing keys', async () => {
      const user = await db.users.get(999);
      expect(user).toBeUndefined();
    });

    it('put updates existing records', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.put({ id: 1, name: 'Alice Updated' });
      const user = await db.users.get(1);
      expect(user.name).toBe('Alice Updated');
    });

    it('delete removes a record', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.delete(1);
      const user = await db.users.get(1);
      expect(user).toBeUndefined();
    });

    it('clear removes all records', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.put({ id: 2, name: 'Bob' });
      await db.users.clear();
      const count = await db.users.count();
      expect(count).toBe(0);
    });

    it('getAll returns all records', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.put({ id: 2, name: 'Bob' });
      await db.users.put({ id: 3, name: 'Charlie' });
      const all = await db.users.getAll();
      expect(all).toHaveLength(3);
    });

    it('count returns the number of records', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.put({ id: 2, name: 'Bob' });
      expect(await db.users.count()).toBe(2);
    });

    it('getMany returns multiple records', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.put({ id: 2, name: 'Bob' });
      const results = await db.users.getMany([1, 2, 999]);
      expect(results[0]).toEqual({ id: 1, name: 'Alice' });
      expect(results[1]).toEqual({ id: 2, name: 'Bob' });
      expect(results[2]).toBeUndefined();
    });

    it('putMany inserts multiple records', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]);
      expect(await db.users.count()).toBe(3);
    });
  });

  describe('autoIncrement', () => {
    it('generates auto-incrementing keys', async () => {
      const k1 = await db.tasks.put({ title: 'Task 1' });
      const k2 = await db.tasks.put({ title: 'Task 2' });
      expect(k1).toBe(1);
      expect(k2).toBe(2);
    });

    it('assigns generated key to the record', async () => {
      await db.tasks.put({ title: 'Task 1' });
      const task = await db.tasks.get(1);
      expect(task.id).toBe(1);
      expect(task.title).toBe('Task 1');
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

  describe('Transactions', () => {
    it('commits on success', async () => {
      await db.transaction(['users', 'tasks'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Alice' });
        await tx.tasks.put({ title: 'Task 1' });
      });
      expect(await db.users.get(1)).toBeDefined();
      expect(await db.tasks.get(1)).toBeDefined();
    });

    it('rolls back on error', async () => {
      await db.users.put({ id: 1, name: 'Alice' });

      try {
        await db.transaction(['users'], async (tx) => {
          await tx.users.put({ id: 2, name: 'Bob' });
          throw new Error('abort');
        });
      } catch (_) {}

      expect(await db.users.get(2)).toBeUndefined();
      expect(await db.users.get(1)).toBeDefined();
    });
  });

  describe('Cursor', () => {
    it('iterates records via async iterator', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.users.put({ id: 2, name: 'Bob' });

      const results = [];
      for await (const user of db.users.all()) {
        results.push(user);
      }
      expect(results).toHaveLength(2);
    });
  });

  describe('Persistence', () => {
    it('data persists across re-opens', async () => {
      await db.users.put({ id: 1, name: 'Alice' });

      // Re-open the same database
      const db2 = await EasyDB.open(name, {
        adapter,
        schema(b) {
          b.createStore('users', { key: 'id' });
          b.createStore('tasks', { key: 'id', autoIncrement: true });
        },
      });

      const user = await db2.users.get(1);
      expect(user).toEqual({ id: 1, name: 'Alice' });
    });
  });

  describe('destroy()', () => {
    it('removes all data from localStorage', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      const keysBefore = storage.size;
      expect(keysBefore).toBeGreaterThan(0);

      await EasyDB.destroy(name, { adapter });

      // Count keys with our prefix
      const prefix = `easydb:${name}:`;
      let remaining = 0;
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) remaining++;
      }
      expect(remaining).toBe(0);
    });
  });
});
