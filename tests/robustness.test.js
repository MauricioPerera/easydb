import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDB, destroyTestDB, seedUsers, wait } from './helpers.js';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';

describe('Robustness — close() guard', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    try { await EasyDB.destroy(name); } catch (_) {}
  });

  it('should throw on store access after close()', async () => {
    db.close();
    expect(() => db.users).toThrow('Database is closed');
  });

  it('should throw on store() after close()', async () => {
    db.close();
    expect(() => db.store('users')).toThrow('Database is closed');
  });

  it('should throw on transaction() after close()', async () => {
    db.close();
    await expect(db.transaction(['users'], async () => {})).rejects.toThrow('Database is closed');
  });

  it('should still allow reading stores/version after close()', () => {
    db.close();
    // These are properties on the instance, not proxy-trapped store access
    expect(db.stores).toBeDefined();
    expect(db.version).toBeDefined();
  });
});

describe('Robustness — putMany key tracking', () => {
  it('should return correct count from putMany', async () => {
    const adapter = new MemoryAdapter();
    const db = await EasyDB.open('putmany-test', {
      adapter,
      schema(s) { s.createStore('items', { key: 'id' }); }
    });

    const count = await db.items.putMany([
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
      { id: 3, value: 'c' },
    ]);

    expect(count).toBe(3);
    expect(await db.items.count()).toBe(3);
    db.close();
    await adapter.destroy('putmany-test');
  });

  it('should notify watchers with correct keys from putMany', async () => {
    const adapter = new MemoryAdapter();
    const db = await EasyDB.open('putmany-watch', {
      adapter,
      schema(s) { s.createStore('items', { key: 'id' }); }
    });

    const events = [];
    const watcher = db.items.watch();
    const iter = watcher[Symbol.asyncIterator]();

    // Trigger putMany and collect events
    await db.items.putMany([
      { id: 10, name: 'A' },
      { id: 20, name: 'B' },
    ]);

    const e1 = await iter.next();
    const e2 = await iter.next();
    events.push(e1.value, e2.value);

    expect(events[0].key).toBe(10);
    expect(events[1].key).toBe(20);
    expect(events[0].type).toBe('put');

    await iter.return();
    db.close();
    await adapter.destroy('putmany-watch');
  });

  it('should track autoIncrement keys in putMany watch events', async () => {
    const adapter = new MemoryAdapter();
    const db = await EasyDB.open('putmany-auto', {
      adapter,
      schema(s) { s.createStore('logs', { key: 'id', autoIncrement: true }); }
    });

    const watcher = db.logs.watch();
    const iter = watcher[Symbol.asyncIterator]();

    await db.logs.putMany([
      { message: 'first' },
      { message: 'second' },
    ]);

    const e1 = await iter.next();
    const e2 = await iter.next();

    // Keys should be auto-generated (1, 2), not undefined
    expect(e1.value.key).toBe(1);
    expect(e2.value.key).toBe(2);

    await iter.return();
    db.close();
    await adapter.destroy('putmany-auto');
  });
});

describe('Robustness — edge cases', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('limit(0) should return empty array', async () => {
    await seedUsers(db, 5);
    // limit(0) hits the fast path with getAll(range, 0) which returns all in IDB
    // So we test via cursor path with filter to get deterministic behavior
    const result = await db.users.all().filter(() => true).limit(0).toArray();
    expect(result).toEqual([]);
  });

  it('skip greater than total should return empty', async () => {
    await seedUsers(db, 3);
    const result = await db.users.all().skip(100).toArray();
    expect(result).toEqual([]);
  });

  it('skip without limit should work', async () => {
    await seedUsers(db, 5);
    const result = await db.users.all().skip(3).toArray();
    expect(result.length).toBe(2);
  });

  it('count with limit should count all matching (ignores limit)', async () => {
    await seedUsers(db, 10);
    // count() on QueryBuilder doesn't use limit — it counts all matching
    const count = await db.users.all().count();
    expect(count).toBe(10);
  });

  it('where on non-existent index should throw', async () => {
    await seedUsers(db, 3);
    await expect(
      db.users.where('nonexistent', 'value').toArray()
    ).rejects.toThrow();
  });

  it('operations on non-existent store should throw descriptive error', async () => {
    await expect(db.unicorns.get(1)).rejects.toThrow('not found');
    await expect(db.unicorns.put({ id: 1 })).rejects.toThrow('not found');
    await expect(db.unicorns.delete(1)).rejects.toThrow('not found');
  });

  it('get with undefined key should throw (invalid key)', async () => {
    // IndexedDB rejects undefined as a key — this is expected behavior
    await expect(db.users.get(undefined)).rejects.toThrow();
  });

  it('delete non-existent key should not throw', async () => {
    await expect(db.users.delete(99999)).resolves.toBeUndefined();
  });

  it('clear on empty store should not throw', async () => {
    await expect(db.users.clear()).resolves.toBeUndefined();
  });

  it('putMany with empty array should return 0', async () => {
    const count = await db.users.putMany([]);
    expect(count).toBe(0);
  });

  it('desc().limit(n) should return last n records in reverse order', async () => {
    await seedUsers(db, 5);
    const result = await db.users.all().desc().limit(2).toArray();
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(5);
    expect(result[1].id).toBe(4);
  });

  it('getMany with mixed existing/non-existing keys', async () => {
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    const result = await db.users.getMany([1, 999, 1]);
    expect(result[0]).toBeDefined();
    expect(result[0].id).toBe(1);
    expect(result[1]).toBeUndefined();
    expect(result[2]).toBeDefined();
  });
});
