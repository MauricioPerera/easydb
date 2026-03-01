import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { RedisAdapter } from '../src/adapters/redis.js';

// ── Mock Redis client ─────────────────────────────────────
// Simulates ioredis API with in-memory storage.

function createMockRedis() {
  const store = new Map(); // key -> string value
  const hashes = new Map(); // key -> Map<field, value>

  return {
    async get(key) {
      return store.get(key) ?? null;
    },

    async set(key, value) {
      store.set(key, value);
    },

    async del(key) {
      store.delete(key);
      hashes.delete(key);
    },

    async hget(key, field) {
      const hash = hashes.get(key);
      return hash?.get(field) ?? null;
    },

    async hset(key, ...args) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const hash = hashes.get(key);

      // Support hset(key, field, value) and hset(key, field1, val1, field2, val2, ...)
      for (let i = 0; i < args.length; i += 2) {
        hash.set(args[i], args[i + 1]);
      }
    },

    async hdel(key, field) {
      const hash = hashes.get(key);
      if (hash) hash.delete(field);
    },

    async hgetall(key) {
      const hash = hashes.get(key);
      if (!hash || hash.size === 0) return {};
      const result = {};
      for (const [field, value] of hash) {
        result[field] = value;
      }
      return result;
    },

    async hlen(key) {
      const hash = hashes.get(key);
      return hash ? hash.size : 0;
    },

    async hmget(key, ...fields) {
      const hash = hashes.get(key);
      return fields.map(f => hash?.get(f) ?? null);
    },

    async incr(key) {
      const current = parseInt(store.get(key) || '0', 10);
      const next = current + 1;
      store.set(key, String(next));
      return next;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('Redis Adapter', () => {
  let db, name, adapter, redis;

  beforeEach(async () => {
    redis = createMockRedis();
    adapter = new RedisAdapter(redis);
    name = 'redis-test-' + Math.random().toString(36).slice(2);
    db = await EasyDB.open(name, {
      adapter,
      schema(b) {
        b.createStore('users', { key: 'id' });
        b.createStore('sessions', { key: 'sid' });
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

  describe('Multiple stores', () => {
    it('stores data independently', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await db.sessions.put({ sid: 'abc', userId: 1 });

      expect(await db.users.count()).toBe(1);
      expect(await db.sessions.count()).toBe(1);

      const session = await db.sessions.get('abc');
      expect(session.userId).toBe(1);
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

    it('desc() reverses order', async () => {
      const desc = await db.users.all().desc().toArray();
      expect(desc[0].id).toBe(3);
      expect(desc[desc.length - 1].id).toBe(1);
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

  describe('Transactions', () => {
    it('commits on success', async () => {
      await db.transaction(['users', 'sessions'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Alice' });
        await tx.sessions.put({ sid: 'abc', userId: 1 });
      });
      expect(await db.users.get(1)).toBeDefined();
      expect(await db.sessions.get('abc')).toBeDefined();
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

  describe('Store metadata', () => {
    it('reports store names', () => {
      expect(db.stores).toContain('users');
      expect(db.stores).toContain('sessions');
      expect(db.stores).toContain('tasks');
    });

    it('hasStore returns correct values', () => {
      expect(db._conn.hasStore('users')).toBe(true);
      expect(db._conn.hasStore('nonexistent')).toBe(false);
    });

    it('getKeyPath returns correct values', () => {
      expect(db._conn.getKeyPath('users')).toBe('id');
      expect(db._conn.getKeyPath('sessions')).toBe('sid');
    });
  });

  describe('destroy()', () => {
    it('removes all data', async () => {
      await db.users.put({ id: 1, name: 'Alice' });
      await EasyDB.destroy(name, { adapter });

      // Re-open should have no data
      const db2 = await EasyDB.open(name, {
        adapter,
        schema(b) {
          b.createStore('users', { key: 'id' });
        },
      });
      expect(await db2.users.count()).toBe(0);
    });
  });
});
