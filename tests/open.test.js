import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';
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

// ── Migrations API ─────────────────────────────────────────

describe('EasyDB — migrations', () => {
  it('creates stores from migrations map (IDB)', async () => {
    const dbName = `mig-idb-${Date.now()}`;
    const db = await EasyDB.open(dbName, {
      migrations: {
        1: (s) => { s.createStore('users', { key: 'id' }); },
        2: (s) => { s.createStore('orders', { key: 'orderId' }); },
      }
    });

    expect(db.version).toBe(2);
    expect(db.stores).toContain('users');
    expect(db.stores).toContain('orders');

    db.close();
    await EasyDB.destroy(dbName);
  });

  it('creates stores from migrations map (Memory)', async () => {
    const adapter = new MemoryAdapter();
    const db = await EasyDB.open('mig-mem', {
      adapter,
      migrations: {
        1: (s) => { s.createStore('users', { key: 'id' }); },
        2: (s) => { s.createStore('logs', { key: 'id', autoIncrement: true }); },
      }
    });

    expect(db.version).toBe(2);
    expect(db.stores).toContain('users');
    expect(db.stores).toContain('logs');
  });

  it('runs only new migrations on version upgrade (Memory)', async () => {
    const adapter = new MemoryAdapter();
    const ran = [];

    // Open at v1
    const db1 = await EasyDB.open('mig-upgrade', {
      adapter,
      migrations: {
        1: (s) => { ran.push(1); s.createStore('users', { key: 'id' }); },
      }
    });
    expect(db1.version).toBe(1);
    expect(ran).toEqual([1]);

    // Re-open at v2 — only migration 2 should run
    const db2 = await EasyDB.open('mig-upgrade', {
      adapter,
      migrations: {
        1: (s) => { ran.push(1); s.createStore('users', { key: 'id' }); },
        2: (s) => { ran.push(2); s.createStore('orders', { key: 'orderId' }); },
      }
    });
    expect(db2.version).toBe(2);
    expect(ran).toEqual([1, 2]); // 1 ran first time, 2 ran on upgrade
    expect(db2.stores).toContain('users');
    expect(db2.stores).toContain('orders');
  });

  it('auto-infers version from highest migration key', async () => {
    const adapter = new MemoryAdapter();
    const db = await EasyDB.open('mig-auto-ver', {
      adapter,
      migrations: {
        1: (s) => { s.createStore('a', { key: 'id' }); },
        5: (s) => { s.createStore('b', { key: 'id' }); },
        3: (s) => { s.createStore('c', { key: 'id' }); },
      }
    });
    expect(db.version).toBe(5);
  });

  it('explicit version overrides auto-inferred version', async () => {
    const adapter = new MemoryAdapter();
    const db = await EasyDB.open('mig-explicit-ver', {
      adapter,
      version: 10,
      migrations: {
        1: (s) => { s.createStore('items', { key: 'id' }); },
      }
    });
    expect(db.version).toBe(10);
  });

  it('preserves data across migrations (Memory)', async () => {
    const adapter = new MemoryAdapter();

    // V1: create users and add data
    const db1 = await EasyDB.open('mig-data', {
      adapter,
      migrations: {
        1: (s) => { s.createStore('users', { key: 'id' }); },
      }
    });
    await db1.users.put({ id: 1, name: 'Alice' });

    // V2: add orders store — users data should persist
    const db2 = await EasyDB.open('mig-data', {
      adapter,
      migrations: {
        1: (s) => { s.createStore('users', { key: 'id' }); },
        2: (s) => { s.createStore('orders', { key: 'orderId' }); },
      }
    });
    const user = await db2.users.get(1);
    expect(user.name).toBe('Alice');
    expect(db2.stores).toContain('orders');
  });
});
