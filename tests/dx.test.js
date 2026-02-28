import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { createTestDB, destroyTestDB, seedUsers } from './helpers.js';

describe('db.stores — list available store names', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should return an array of store names', () => {
    const stores = db.stores;
    expect(Array.isArray(stores)).toBe(true);
    expect(stores).toContain('users');
    expect(stores).toContain('orders');
    expect(stores).toHaveLength(2);
  });

  it('should return a fresh array (not a live reference)', () => {
    const a = db.stores;
    const b = db.stores;
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('db.store() — explicit store access', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should return a StoreAccessor for a valid store', async () => {
    const accessor = db.store('users');
    expect(accessor).toBeDefined();
    expect(typeof accessor.get).toBe('function');
    expect(typeof accessor.put).toBe('function');
  });

  it('should work with full CRUD', async () => {
    await db.store('users').put({ id: 1, name: 'Mau', email: 'mau@t.com', role: 'admin', country: 'UY', age: 35 });
    const user = await db.store('users').get(1);
    expect(user.name).toBe('Mau');
  });

  it('should allow accessing stores that collide with method names', async () => {
    // Create a DB with a store named "transaction"
    const dbName = `test-collision-${Date.now()}`;
    const db2 = await EasyDB.open(dbName, {
      schema(db) {
        db.createStore('transaction', { key: 'id' });
        db.createStore('close', { key: 'id' });
        db.createStore('stores', { key: 'id' });
      }
    });

    // Proxy returns the method for "transaction", not a StoreAccessor
    expect(typeof db2.transaction).toBe('function');

    // But db.store() bypasses the collision
    await db2.store('transaction').put({ id: 1, name: 'test' });
    const item = await db2.store('transaction').get(1);
    expect(item.name).toBe('test');

    await db2.store('close').put({ id: 1, name: 'closeable' });
    const item2 = await db2.store('close').get(1);
    expect(item2.name).toBe('closeable');

    await db2.store('stores').put({ id: 1, name: 'meta' });
    const item3 = await db2.store('stores').get(1);
    expect(item3.name).toBe('meta');

    db2.close();
    await EasyDB.destroy(dbName);
  });
});

describe('Friendly error messages — store not found', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should throw friendly error on get() with wrong store', async () => {
    await expect(db.typo.get(1)).rejects.toThrow(/Store "typo" not found/);
    await expect(db.typo.get(1)).rejects.toThrow(/Available stores:/);
  });

  it('should list available stores in error message', async () => {
    try {
      await db.nonexistent.get(1);
    } catch (err) {
      expect(err.message).toContain('users');
      expect(err.message).toContain('orders');
    }
  });

  it('should throw friendly error on put() with wrong store', async () => {
    await expect(db.nope.put({ id: 1 })).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on delete() with wrong store', async () => {
    await expect(db.nope.delete(1)).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on count() with wrong store', async () => {
    await expect(db.nope.count()).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on getAll() with wrong store', async () => {
    await expect(db.nope.getAll()).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on getMany() with wrong store', async () => {
    await expect(db.nope.getMany([1, 2])).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on putMany() with wrong store', async () => {
    await expect(db.nope.putMany([{ id: 1 }])).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on clear() with wrong store', async () => {
    await expect(db.nope.clear()).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on query toArray() with wrong store', async () => {
    await expect(db.nope.all().toArray()).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on query count() with wrong store', async () => {
    await expect(db.nope.all().count()).rejects.toThrow(/Store "nope" not found/);
  });

  it('should throw friendly error on for-await with wrong store', async () => {
    const fn = async () => {
      for await (const _ of db.nope.all()) { /* */ }
    };
    await expect(fn()).rejects.toThrow(/Store "nope" not found/);
  });

  it('should NOT throw for valid stores', async () => {
    await expect(db.users.get(1)).resolves.not.toThrow();
    await expect(db.orders.getAll()).resolves.not.toThrow();
  });

  it('should work via db.store() too', async () => {
    await expect(db.store('nope').get(1)).rejects.toThrow(/Store "nope" not found/);
  });
});
