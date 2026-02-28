import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { D1Adapter } from '../src/adapters/d1.js';
import { MockD1Database } from './d1-mock.js';

let d1, adapter, dbCounter = 0;

async function createD1DB(customSchema) {
  const name = `d1-test-${Date.now()}-${dbCounter++}`;
  const db = await EasyDB.open(name, {
    adapter,
    schema: customSchema || ((s) => {
      s.createStore('users', {
        key: 'id',
        indexes: ['role', 'country', 'age', { name: 'email', unique: true }]
      });
      s.createStore('orders', {
        key: 'orderId',
        indexes: ['userId', 'total']
      });
    })
  });
  return { db, name };
}

async function seedUsers(db, count = 10) {
  const users = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@test.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    country: ['UY', 'MX', 'AR', 'CO', 'CL'][i % 5],
    age: 20 + i * 3
  }));
  await db.users.putMany(users);
  return users;
}

function wait(ms = 10) {
  return new Promise(r => setTimeout(r, ms));
}

beforeEach(() => {
  d1 = new MockD1Database();
  adapter = new D1Adapter(d1);
});

afterEach(() => {
  d1.close();
});

// ── CRUD ──────────────────────────────────────────────────

describe('D1Adapter — CRUD', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createD1DB());
  });

  it('put and get a record', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    const user = await db.users.get(1);
    expect(user).toEqual({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
  });

  it('get returns undefined for missing key', async () => {
    const user = await db.users.get(999);
    expect(user).toBeUndefined();
  });

  it('put returns the key', async () => {
    const key = await db.users.put({ id: 42, name: 'Bob', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 });
    expect(key).toBe(42);
  });

  it('put updates existing record (upsert)', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    await db.users.put({ id: 1, name: 'Alice Updated', email: 'a@t.com', role: 'admin', country: 'UY', age: 31 });
    const user = await db.users.get(1);
    expect(user.name).toBe('Alice Updated');
    expect(user.age).toBe(31);
  });

  it('delete removes a record', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    await db.users.delete(1);
    const user = await db.users.get(1);
    expect(user).toBeUndefined();
  });

  it('getAll returns all records', async () => {
    await seedUsers(db, 5);
    const all = await db.users.getAll();
    expect(all).toHaveLength(5);
  });

  it('count returns the number of records', async () => {
    await seedUsers(db, 7);
    const count = await db.users.count();
    expect(count).toBe(7);
  });

  it('clear removes all records', async () => {
    await seedUsers(db, 5);
    await db.users.clear();
    expect(await db.users.count()).toBe(0);
  });

  it('putMany inserts multiple records', async () => {
    const count = await db.users.putMany([
      { id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 },
      { id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
      { id: 3, name: 'C', email: 'c@t.com', role: 'viewer', country: 'AR', age: 30 },
    ]);
    expect(count).toBe(3);
    expect(await db.users.count()).toBe(3);
  });

  it('getMany returns multiple records', async () => {
    await seedUsers(db, 5);
    const results = await db.users.getMany([1, 3, 5]);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(1);
    expect(results[1].id).toBe(3);
    expect(results[2].id).toBe(5);
  });

  it('getMany returns undefined for missing keys', async () => {
    await seedUsers(db, 3);
    const results = await db.users.getMany([1, 999]);
    expect(results[0].id).toBe(1);
    expect(results[1]).toBeUndefined();
  });
});

// ── Query Builder ─────────────────────────────────────────

describe('D1Adapter — QueryBuilder', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createD1DB());
    await seedUsers(db, 10);
  });

  it('all().toArray() returns all records sorted by key', async () => {
    const results = await db.users.all().toArray();
    expect(results).toHaveLength(10);
    expect(results[0].id).toBe(1);
    expect(results[9].id).toBe(10);
  });

  it('all().desc().toArray() returns records in reverse', async () => {
    const results = await db.users.all().desc().toArray();
    expect(results).toHaveLength(10);
    expect(results[0].id).toBe(10);
    expect(results[9].id).toBe(1);
  });

  it('limit(n) returns first n records', async () => {
    const results = await db.users.all().limit(3).toArray();
    expect(results).toHaveLength(3);
    expect(results.map(u => u.id)).toEqual([1, 2, 3]);
  });

  it('desc().limit(n) returns last n records', async () => {
    const results = await db.users.all().desc().limit(3).toArray();
    expect(results).toHaveLength(3);
    expect(results.map(u => u.id)).toEqual([10, 9, 8]);
  });

  it('where(index, value) filters by exact index match', async () => {
    const results = await db.users.where('role', 'admin').toArray();
    expect(results.every(u => u.role === 'admin')).toBe(true);
    expect(results).toHaveLength(4); // ids 1,4,7,10
  });

  it('where(index).gt(val) filters by range', async () => {
    const results = await db.users.where('age').gt(35).toArray();
    expect(results.every(u => u.age > 35)).toBe(true);
  });

  it('where(index).gte(val)', async () => {
    const results = await db.users.where('age').gte(38).toArray();
    expect(results.every(u => u.age >= 38)).toBe(true);
    expect(results.some(u => u.age === 38)).toBe(true);
  });

  it('where(index).lt(val)', async () => {
    const results = await db.users.where('age').lt(26).toArray();
    expect(results.every(u => u.age < 26)).toBe(true);
  });

  it('where(index).lte(val)', async () => {
    const results = await db.users.where('age').lte(23).toArray();
    expect(results.every(u => u.age <= 23)).toBe(true);
    expect(results.some(u => u.age === 23)).toBe(true);
  });

  it('where(index).between(lo, hi)', async () => {
    const results = await db.users.where('age').between(25, 40).toArray();
    expect(results.every(u => u.age >= 25 && u.age <= 40)).toBe(true);
  });

  it('filter() applies JS predicate', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'admin')
      .toArray();
    expect(results).toHaveLength(4);
    expect(results.every(u => u.role === 'admin')).toBe(true);
  });

  it('filter() composes with chaining', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'admin')
      .filter(u => u.age > 30)
      .toArray();
    expect(results.every(u => u.role === 'admin' && u.age > 30)).toBe(true);
  });

  it('count() returns total without filter', async () => {
    const count = await db.users.all().count();
    expect(count).toBe(10);
  });

  it('count() with range', async () => {
    const count = await db.users.where('age').gt(35).count();
    // ages: 20,23,26,29,32,35,38,41,44,47 → >35 = 38,41,44,47 = 4
    expect(count).toBe(4);
  });

  it('count() with filter', async () => {
    const count = await db.users.all()
      .filter(u => u.role === 'admin')
      .count();
    expect(count).toBe(4);
  });

  it('first() returns first matching record', async () => {
    const user = await db.users.all().first();
    expect(user.id).toBe(1);
  });

  it('first() with desc returns last record', async () => {
    const user = await db.users.all().desc().first();
    expect(user.id).toBe(10);
  });

  it('for await iterates records', async () => {
    const results = [];
    for await (const user of db.users.all().limit(3)) {
      results.push(user);
    }
    expect(results).toHaveLength(3);
    expect(results.map(u => u.id)).toEqual([1, 2, 3]);
  });

  it('for await with break stops early', async () => {
    const results = [];
    for await (const user of db.users.all()) {
      results.push(user);
      if (results.length >= 2) break;
    }
    expect(results).toHaveLength(2);
  });
});

// ── Watch engine ──────────────────────────────────────────

describe('D1Adapter — Watch', () => {
  it('emits put events', async () => {
    const { db } = await createD1DB();
    const events = [];

    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('put');
    expect(events[0].key).toBe(1);
  });

  it('emits delete events', async () => {
    const { db } = await createD1DB();
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });

    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db.users.delete(1);
    await watchPromise;

    expect(events[0].type).toBe('delete');
    expect(events[0].key).toBe(1);
  });

  it('filters by key', async () => {
    const { db } = await createD1DB();
    const events = [];

    const watchPromise = (async () => {
      for await (const evt of db.users.watch({ key: 2 })) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 });
    await db.users.put({ id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].key).toBe(2);
  });
});

// ── Transactions ──────────────────────────────────────────

describe('D1Adapter — Transactions', () => {
  it('commits multiple operations', async () => {
    const { db } = await createD1DB();

    await db.transaction(['users', 'orders'], async (tx) => {
      await tx.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
      await tx.orders.put({ orderId: 'o1', userId: 1, total: 100 });
    });

    const user = await db.users.get(1);
    const order = await db.orders.get('o1');
    expect(user.name).toBe('Alice');
    expect(order.total).toBe(100);
  });

  it('rolls back on error', async () => {
    const { db } = await createD1DB();
    await db.users.put({ id: 1, name: 'Original', email: 'o@t.com', role: 'admin', country: 'UY', age: 30 });

    await expect(
      db.transaction(['users'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Modified', email: 'o@t.com', role: 'admin', country: 'UY', age: 30 });
        throw new Error('rollback test');
      })
    ).rejects.toThrow('rollback test');

    const user = await db.users.get(1);
    expect(user.name).toBe('Original');
  });
});

// ── Schema & Lifecycle ───────────────────────────────────

describe('D1Adapter — Lifecycle', () => {
  it('opens a database with stores', async () => {
    const { db } = await createD1DB();
    expect(db.stores).toContain('users');
    expect(db.stores).toContain('orders');
  });

  it('reports version', async () => {
    const db = await EasyDB.open('d1-version-test', {
      adapter,
      version: 3,
      schema(s) { s.createStore('items', { key: 'id' }); }
    });
    expect(db.version).toBe(3);
  });

  it('destroy removes all tables', async () => {
    const db = await EasyDB.open('d1-destroy-test', {
      adapter,
      schema(s) { s.createStore('items', { key: 'id' }); }
    });
    await db.store('items').put({ id: 1, value: 'test' });
    db.close();

    await EasyDB.destroy('d1-destroy-test', { adapter });

    // Re-open — should be empty
    const db2 = await EasyDB.open('d1-destroy-test', {
      adapter,
      schema(s) { s.createStore('items', { key: 'id' }); }
    });
    expect(await db2.store('items').count()).toBe(0);
  });

  it('db.store() works for explicit access', async () => {
    const { db } = await createD1DB();
    const accessor = db.store('users');
    await accessor.put({ id: 1, name: 'Test', email: 't@t.com', role: 'admin', country: 'UY', age: 25 });
    const user = await accessor.get(1);
    expect(user.name).toBe('Test');
  });

  it('friendly error for non-existent store', async () => {
    const { db } = await createD1DB();
    await expect(db.nope.get(1)).rejects.toThrow(/Store "nope" not found/);
  });
});

// ── Unique indexes (SQL UNIQUE constraint) ───────────────

describe('D1Adapter — Unique indexes', () => {
  it('rejects duplicate values on unique index', async () => {
    const { db } = await createD1DB();
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    await expect(
      db.users.put({ id: 2, name: 'Bob', email: 'a@t.com', role: 'editor', country: 'MX', age: 25 })
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('allows updating same record with same unique value', async () => {
    const { db } = await createD1DB();
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    await db.users.put({ id: 1, name: 'Alice Updated', email: 'a@t.com', role: 'admin', country: 'UY', age: 31 });
    const user = await db.users.get(1);
    expect(user.name).toBe('Alice Updated');
  });
});

// ── AutoIncrement ─────────────────────────────────────────

describe('D1Adapter — AutoIncrement', () => {
  it('auto-generates keys', async () => {
    const db = await EasyDB.open('d1-autoinc-test', {
      adapter,
      schema(s) { s.createStore('logs', { key: 'id', autoIncrement: true }); }
    });

    const key1 = await db.store('logs').put({ id: undefined, msg: 'first' });
    const key2 = await db.store('logs').put({ id: undefined, msg: 'second' });
    expect(key2).toBeGreaterThan(key1);

    const log = await db.store('logs').get(key1);
    expect(log.msg).toBe('first');
    expect(log.id).toBe(key1);
  });

  it('putMany on autoIncrement stores back-patches keys', async () => {
    const db = await EasyDB.open('d1-autoinc-putmany', {
      adapter,
      schema(s) { s.createStore('logs', { key: 'id', autoIncrement: true }); }
    });

    await db.store('logs').putMany([
      { msg: 'first' },
      { msg: 'second' },
      { msg: 'third' },
    ]);

    const all = await db.store('logs').getAll();
    expect(all).toHaveLength(3);
    // Each record should have its auto-generated id field
    expect(all[0].id).toBeDefined();
    expect(all[1].id).toBeDefined();
    expect(all[2].id).toBeDefined();
    expect(all[0].msg).toBe('first');
  });
});

// ── Cursor ────────────────────────────────────────────────

describe('D1Adapter — Cursor', () => {
  it('iterates in ascending order', async () => {
    const { db } = await createD1DB();
    await seedUsers(db, 5);

    const results = [];
    for await (const user of db.users.all()) {
      results.push(user);
    }
    expect(results).toHaveLength(5);
    expect(results[0].id).toBe(1);
    expect(results[4].id).toBe(5);
  });

  it('iterates in descending order', async () => {
    const { db } = await createD1DB();
    await seedUsers(db, 5);

    const results = [];
    for await (const user of db.users.all().desc()) {
      results.push(user);
    }
    expect(results).toHaveLength(5);
    expect(results[0].id).toBe(5);
    expect(results[4].id).toBe(1);
  });

  it('supports range in cursor', async () => {
    const { db } = await createD1DB();
    await seedUsers(db, 10);

    const results = [];
    for await (const user of db.users.where('age').between(25, 35)) {
      results.push(user);
    }
    // ages: 20,23,26,29,32,35,38,41,44,47 → between 25-35: 26,29,32,35 = 4
    expect(results).toHaveLength(4);
    expect(results.every(u => u.age >= 25 && u.age <= 35)).toBe(true);
  });
});

// ── API parity ────────────────────────────────────────────

describe('D1Adapter — API parity', () => {
  it('same query results as would be expected from other adapters', async () => {
    const { db } = await createD1DB();
    await seedUsers(db, 10);

    // where + range + limit
    const results = await db.users.where('age').gt(30).limit(2).toArray();
    expect(results).toHaveLength(2);
    expect(results.every(u => u.age > 30)).toBe(true);

    // where + exact match
    const admins = await db.users.where('role', 'admin').toArray();
    expect(admins.every(u => u.role === 'admin')).toBe(true);

    // all + filter + desc
    const descAdmins = await db.users.all()
      .filter(u => u.role === 'admin')
      .desc()
      .toArray();
    expect(descAdmins[0].id).toBeGreaterThan(descAdmins[descAdmins.length - 1].id);
  });
});
