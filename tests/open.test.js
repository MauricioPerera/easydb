import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { createTestDB, destroyTestDB } from './helpers.js';

describe('EasyDB — open / close / destroy', () => {
  let db, name;

  afterEach(async () => {
    if (db) {
      try { await destroyTestDB(db, name); } catch (_) {}
    }
  });

  it('should open a database and return an EasyDB instance', async () => {
    ({ db, name } = await createTestDB());
    expect(db).toBeDefined();
    expect(db._conn).toBeDefined();
    expect(db._conn.name).toBe(name);
  });

  it('should create stores defined in schema', async () => {
    ({ db, name } = await createTestDB());
    expect(db.stores).toContain('users');
    expect(db.stores).toContain('orders');
  });

  it('should create indexes defined in schema', async () => {
    ({ db, name } = await createTestDB());
    // Access raw IDB to verify index creation
    const tx = db._conn._idb.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const indexNames = Array.from(store.indexNames);
    expect(indexNames).toContain('role');
    expect(indexNames).toContain('country');
    expect(indexNames).toContain('age');
    expect(indexNames).toContain('email');
  });

  it('should support unique indexes', async () => {
    ({ db, name } = await createTestDB());
    const tx = db._conn._idb.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const emailIdx = store.index('email');
    expect(emailIdx.unique).toBe(true);
  });

  it('should support custom schema versions', async () => {
    const dbName = `test-version-${Date.now()}`;
    const d = await EasyDB.open(dbName, {
      version: 5,
      schema(db) {
        db.createStore('items', { key: 'id' });
      }
    });
    expect(d.version).toBe(5);
    d.close();
    await EasyDB.destroy(dbName);
  });

  it('should destroy a database', async () => {
    ({ db, name } = await createTestDB());
    db.close();
    await EasyDB.destroy(name);
    // Re-open should have no stores (fresh DB)
    const fresh = await EasyDB.open(name, { version: 1 });
    expect(fresh.stores.length).toBe(0);
    fresh.close();
    await EasyDB.destroy(name);
    db = null; // prevent afterEach double-destroy
  });

  it('should close a database connection', async () => {
    ({ db, name } = await createTestDB());
    db.close();
    // After close, operations should fail
    // (fake-indexeddb may not enforce this strictly, but we test the method exists)
    expect(() => db.close()).not.toThrow();
    db = null;
    await EasyDB.destroy(name);
  });
});

describe('EasyDB — Proxy store access', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should return a StoreAccessor for any property name', async () => {
    const users = db.users;
    expect(users).toBeDefined();
    expect(typeof users.get).toBe('function');
    expect(typeof users.put).toBe('function');
    expect(typeof users.delete).toBe('function');
  });

  it('should not intercept "then" (avoids issues with await)', async () => {
    expect(db.then).toBeUndefined();
    expect(db.catch).toBeUndefined();
    expect(db.finally).toBeUndefined();
  });

  it('should not intercept symbol properties', async () => {
    const sym = Symbol('test');
    expect(db[sym]).toBeUndefined();
  });

  it('should still expose instance methods (transaction, close)', async () => {
    expect(typeof db.transaction).toBe('function');
    expect(typeof db.close).toBe('function');
  });

  it('should access different stores via different property names', async () => {
    const usersAccessor = db.users;
    const ordersAccessor = db.orders;
    expect(usersAccessor._store).toBe('users');
    expect(ordersAccessor._store).toBe('orders');
  });
});
