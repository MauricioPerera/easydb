import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { MongoAdapter } from '../src/adapters/mongo.js';

// ── Mock MongoDB client ───────────────────────────────────
// Simulates the mongodb driver Db and Collection API in-memory.

function createMockDb() {
  const collections = new Map(); // name -> MockCollection

  function getCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, createMockCollection());
    }
    return collections.get(name);
  }

  return {
    collection(name) { return getCollection(name); },

    // For drop — remove collection data
    _dropCollection(name) { collections.delete(name); },
  };
}

function createMockCollection() {
  let docs = []; // array of documents
  const indexes = []; // track created indexes

  function matchesFilter(doc, filter) {
    for (const [key, val] of Object.entries(filter)) {
      const docVal = doc[key];
      if (val != null && typeof val === 'object' && !Array.isArray(val)) {
        // MongoDB query operators
        if ('$gt' in val && !(docVal > val.$gt)) return false;
        if ('$gte' in val && !(docVal >= val.$gte)) return false;
        if ('$lt' in val && !(docVal < val.$lt)) return false;
        if ('$lte' in val && !(docVal <= val.$lte)) return false;
        if ('$inc' in val) return false; // $inc is an update op, not a filter
      } else {
        if (docVal !== val) return false;
      }
    }
    return true;
  }

  function applyProjection(doc, projection) {
    if (!projection || Object.keys(projection).length === 0) return { ...doc };
    const result = {};
    const excluding = Object.values(projection).some(v => v === 0);
    if (excluding) {
      for (const [k, v] of Object.entries(doc)) {
        if (projection[k] !== 0) result[k] = v;
      }
    } else {
      for (const key of Object.keys(projection)) {
        if (doc[key] !== undefined) result[key] = doc[key];
      }
    }
    return result;
  }

  const col = {
    async findOne(filter, opts) {
      const doc = docs.find(d => matchesFilter(d, filter));
      if (!doc) return null;
      return opts?.projection ? applyProjection(doc, opts.projection) : { ...doc };
    },

    find(filter = {}, opts = {}) {
      let results = docs.filter(d => matchesFilter(d, filter));
      if (opts.projection) {
        results = results.map(d => applyProjection(d, opts.projection));
      } else {
        results = results.map(d => ({ ...d }));
      }

      let sortSpec = null;
      let limitN = null;

      const cursor = {
        sort(spec) { sortSpec = spec; return cursor; },
        limit(n) { limitN = n; return cursor; },
        async toArray() {
          let r = [...results];
          if (sortSpec) {
            const entries = Object.entries(sortSpec);
            r.sort((a, b) => {
              for (const [field, dir] of entries) {
                if (a[field] < b[field]) return -1 * dir;
                if (a[field] > b[field]) return 1 * dir;
              }
              return 0;
            });
          }
          if (limitN != null) r = r.slice(0, limitN);
          return r;
        },
        [Symbol.asyncIterator]() {
          let idx = 0;
          let sorted = null;
          return {
            async next() {
              if (!sorted) {
                sorted = [...results];
                if (sortSpec) {
                  const entries = Object.entries(sortSpec);
                  sorted.sort((a, b) => {
                    for (const [field, dir] of entries) {
                      if (a[field] < b[field]) return -1 * dir;
                      if (a[field] > b[field]) return 1 * dir;
                    }
                    return 0;
                  });
                }
                if (limitN != null) sorted = sorted.slice(0, limitN);
              }
              if (idx >= sorted.length) return { value: undefined, done: true };
              return { value: sorted[idx++], done: false };
            },
            [Symbol.asyncIterator]() { return this; }
          };
        }
      };
      return cursor;
    },

    async replaceOne(filter, replacement, opts = {}) {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx >= 0) {
        docs[idx] = { ...replacement };
      } else if (opts.upsert) {
        docs.push({ ...replacement });
      }
    },

    async deleteOne(filter) {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx >= 0) docs.splice(idx, 1);
    },

    async deleteMany(filter = {}) {
      if (Object.keys(filter).length === 0) {
        docs = [];
      } else {
        docs = docs.filter(d => !matchesFilter(d, filter));
      }
    },

    async insertMany(items) {
      for (const item of items) docs.push({ ...item });
    },

    async countDocuments(filter = {}) {
      if (Object.keys(filter).length === 0) return docs.length;
      return docs.filter(d => matchesFilter(d, filter)).length;
    },

    async createIndex(spec, opts = {}) {
      indexes.push({ spec, opts });
    },

    async findOneAndUpdate(filter, update, opts = {}) {
      let doc = docs.find(d => matchesFilter(d, filter));
      if (!doc && opts.upsert) {
        doc = { ...filter };
        docs.push(doc);
      }
      if (doc && update.$inc) {
        for (const [key, inc] of Object.entries(update.$inc)) {
          doc[key] = (doc[key] || 0) + inc;
        }
      }
      if (doc && update.$set) {
        for (const [key, val] of Object.entries(update.$set)) {
          doc[key] = val;
        }
      }
      if (opts.returnDocument === 'after') {
        return doc ? { ...doc } : null;
      }
      return doc ? { ...doc } : null;
    },

    async updateOne(filter, update, opts = {}) {
      let doc = docs.find(d => matchesFilter(d, filter));
      if (!doc && opts.upsert) {
        doc = { ...filter };
        docs.push(doc);
      }
      if (doc && update.$set) {
        for (const [key, val] of Object.entries(update.$set)) {
          doc[key] = val;
        }
      }
      if (doc && update.$inc) {
        for (const [key, inc] of Object.entries(update.$inc)) {
          doc[key] = (doc[key] || 0) + inc;
        }
      }
    },

    async drop() {
      docs = [];
      indexes.length = 0;
    },
  };

  return col;
}

// ── Tests ─────────────────────────────────────────────────

describe('MongoDB Adapter', () => {
  let db, name, adapter, mockDb;

  beforeEach(async () => {
    mockDb = createMockDb();
    adapter = new MongoAdapter(mockDb);
    name = 'mongo-test-' + Math.random().toString(36).slice(2);
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
