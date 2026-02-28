import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { createTestDB, destroyTestDB, seedUsers, collect, wait } from './helpers.js';

describe('Fix: filter() composes instead of replacing', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
    // roles: admin(1,4,7,10), editor(2,5,8), viewer(3,6,9)
    // countries: UY(1,6), MX(2,7), AR(3,8), CO(4,9), CL(5,10)
    // ages: 20, 23, 26, 29, 32, 35, 38, 41, 44, 47
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should apply both filters when chaining .filter().filter()', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'admin')
      .filter(u => u.age > 30)
      .toArray();
    // admin ids: 1(age20), 4(age29), 7(age38), 10(age47)
    // age > 30: 7, 10
    expect(results).toHaveLength(2);
    expect(results.every(u => u.role === 'admin' && u.age > 30)).toBe(true);
  });

  it('should compose three filters', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'admin')
      .filter(u => u.age > 30)
      .filter(u => u.country === 'MX')
      .toArray();
    // admin + age>30 + MX → only id 7 (age38, MX)
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(7);
  });

  it('should compose filter with where and range', async () => {
    const results = await db.users.where('age').gt(25)
      .filter(u => u.role === 'admin')
      .filter(u => u.country !== 'CL')
      .toArray();
    // age>25: ids 3,4,5,6,7,8,9,10
    // admin among those: 4(CO), 7(MX), 10(CL)
    // exclude CL: 4, 7
    expect(results).toHaveLength(2);
    expect(results.map(u => u.id).sort()).toEqual([4, 7]);
  });

  it('single filter still works as before', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'editor')
      .toArray();
    expect(results).toHaveLength(3);
    expect(results.every(u => u.role === 'editor')).toBe(true);
  });
});

describe('Fix: close() cleans up watchers', () => {
  it('should not emit after close()', async () => {
    const { db: db1, name: name1 } = await createTestDB();
    const events = [];

    const watchPromise = (async () => {
      for await (const evt of db1.users.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();

    // Write triggers watcher
    await db1.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 });
    await watchPromise;
    expect(events).toHaveLength(1);

    // Close should clean up watchers
    db1.close();

    // Re-open and verify a new watcher works independently
    const db2 = await EasyDB.open(name1, {
      schema(db) {
        db.createStore('users', {
          key: 'id',
          indexes: ['role', 'country', 'age', { name: 'email', unique: true }]
        });
      }
    });

    const events2 = [];
    const w2 = (async () => {
      for await (const evt of db2.users.watch()) {
        events2.push(evt);
        if (events2.length >= 1) break;
      }
    })();

    await wait();
    await db2.users.put({ id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 });
    await w2;
    expect(events2).toHaveLength(1);

    db2.close();
    await EasyDB.destroy(name1);
  });
});

describe('Fix: close() does not kill watchers of other databases with prefix-matching names', () => {
  it('closing db "app" should NOT affect watchers of db "app:v2"', async () => {
    const schema = (db) => { db.createStore('items', { key: 'id' }); };

    const db1 = await EasyDB.open('app', { schema });
    const db2 = await EasyDB.open('app:v2', { schema });

    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db2.items.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();

    // Close db1 ("app") — this should NOT touch db2 ("app:v2") watchers
    db1.close();

    // db2's watcher should still work
    await db2.items.put({ id: 1, name: 'still alive' });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].value.name).toBe('still alive');

    db2.close();
    await EasyDB.destroy('app');
    await EasyDB.destroy('app:v2');
  });

  it('closing db "app:v2" should NOT affect watchers of db "app"', async () => {
    const schema = (db) => { db.createStore('items', { key: 'id' }); };

    const db1 = await EasyDB.open('app', { schema });
    const db2 = await EasyDB.open('app:v2', { schema });

    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db1.items.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();

    // Close db2 ("app:v2") — should NOT touch db1 ("app") watchers
    db2.close();

    // db1's watcher should still work
    await db1.items.put({ id: 1, name: 'still alive' });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].value.name).toBe('still alive');

    db1.close();
    await EasyDB.destroy('app');
    await EasyDB.destroy('app:v2');
  });
});

describe('Fix: toArray() fast path with limit', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should use fast path for limit without filter', async () => {
    const results = await db.users.all().limit(3).toArray();
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(1);
    expect(results[2].id).toBe(3);
  });

  it('should handle limit + desc via cursor path', async () => {
    const results = await db.users.all().desc().limit(3).toArray();
    expect(results).toHaveLength(3);
    // desc+limit uses cursor path — returns last 3 in descending order
    expect(results[0].id).toBe(10);
    expect(results[1].id).toBe(9);
    expect(results[2].id).toBe(8);
  });

  it('should use fast path for where + limit', async () => {
    const results = await db.users.where('role', 'admin').limit(2).toArray();
    expect(results).toHaveLength(2);
    expect(results.every(u => u.role === 'admin')).toBe(true);
  });

  it('should use fast path for range + limit', async () => {
    const results = await db.users.where('age').gt(30).limit(2).toArray();
    expect(results).toHaveLength(2);
    expect(results.every(u => u.age > 30)).toBe(true);
  });

  it('should still use cursor path for filter + limit', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'admin')
      .limit(2)
      .toArray();
    expect(results).toHaveLength(2);
    expect(results.every(u => u.role === 'admin')).toBe(true);
  });

  it('limit larger than dataset returns all', async () => {
    const results = await db.users.all().limit(100).toArray();
    expect(results).toHaveLength(10);
  });
});

describe('Fix: version ?? operator', () => {
  it('should default to version 1 when not specified', async () => {
    const dbName = `test-version-default-${Date.now()}`;
    const db = await EasyDB.open(dbName, {
      schema(db) { db.createStore('items', { key: 'id' }); }
    });
    expect(db.version).toBe(1);
    db.close();
    await EasyDB.destroy(dbName);
  });

  it('should respect explicit version', async () => {
    const dbName = `test-version-explicit-${Date.now()}`;
    const db = await EasyDB.open(dbName, {
      version: 3,
      schema(db) { db.createStore('items', { key: 'id' }); }
    });
    expect(db.version).toBe(3);
    db.close();
    await EasyDB.destroy(dbName);
  });
});

describe('Fix: put()/putMany() no extra transaction', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('put() should correctly notify with keyPath-derived key', async () => {
    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db.users.put({ id: 42, name: 'Test', email: 'test@t.com', role: 'admin', country: 'UY', age: 30 });
    await watchPromise;

    expect(events[0].key).toBe(42);
    expect(events[0].value.name).toBe('Test');
  });

  it('putMany() should correctly notify with keyPath-derived keys', async () => {
    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 2) break;
      }
    })();

    await wait();
    await db.users.putMany([
      { id: 10, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 },
      { id: 20, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
    ]);
    await watchPromise;

    expect(events.map(e => e.key)).toEqual([10, 20]);
  });

  it('put() should still return the key', async () => {
    const key = await db.users.put({ id: 7, name: 'X', email: 'x@t.com', role: 'viewer', country: 'AR', age: 22 });
    expect(key).toBe(7);
    const user = await db.users.get(7);
    expect(user.name).toBe('X');
  });
});
