import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { KVAdapter } from '../src/adapters/kv.js';
import { MockKV } from './kv-mock.js';

let db, name, kv;

function createKVDB(customSchema) {
  kv = new MockKV();
  name = `test-kv-${Date.now()}-${Math.random()}`;
  return EasyDB.open(name, {
    adapter: new KVAdapter(kv),
    schema: customSchema || ((s) => {
      s.createStore('users', {
        key: 'id',
        indexes: ['role', 'age', { name: 'email', unique: true }]
      });
      s.createStore('config', { key: 'key' });
    })
  });
}

function seedUsers(db, count = 5) {
  const users = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@test.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    age: 20 + i * 3
  }));
  return db.users.putMany(users).then(() => users);
}

describe('KVAdapter — CRUD', () => {
  beforeEach(async () => { db = await createKVDB(); });
  afterEach(() => { db.close(); });

  it('put and get', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', age: 30 });
    const user = await db.users.get(1);
    expect(user.name).toBe('Alice');
  });

  it('get missing key returns undefined', async () => {
    expect(await db.users.get(999)).toBeUndefined();
  });

  it('put updates existing', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', age: 30 });
    await db.users.put({ id: 1, name: 'Alice Updated', email: 'a@t.com', role: 'admin', age: 31 });
    const user = await db.users.get(1);
    expect(user.name).toBe('Alice Updated');
  });

  it('delete', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', age: 30 });
    await db.users.delete(1);
    expect(await db.users.get(1)).toBeUndefined();
  });

  it('clear', async () => {
    await seedUsers(db);
    await db.users.clear();
    expect(await db.users.count()).toBe(0);
  });

  it('putMany', async () => {
    await seedUsers(db, 5);
    expect(await db.users.count()).toBe(5);
  });

  it('getMany', async () => {
    await seedUsers(db, 5);
    const results = await db.users.getMany([1, 3, 99]);
    expect(results[0].id).toBe(1);
    expect(results[1].id).toBe(3);
    expect(results[2]).toBeUndefined();
  });

  it('getAll', async () => {
    await seedUsers(db, 5);
    const all = await db.users.getAll();
    expect(all).toHaveLength(5);
  });

  it('count', async () => {
    await seedUsers(db, 5);
    expect(await db.users.count()).toBe(5);
  });
});

describe('KVAdapter — autoIncrement', () => {
  beforeEach(async () => {
    db = await createKVDB((s) => {
      s.createStore('items', { key: 'id', autoIncrement: true });
    });
  });
  afterEach(() => { db.close(); });

  it('auto-generates keys', async () => {
    const k1 = await db.items.put({ name: 'A' });
    const k2 = await db.items.put({ name: 'B' });
    expect(k1).toBe(1);
    expect(k2).toBe(2);
  });

  it('auto-generated key is in the stored value', async () => {
    await db.items.put({ name: 'A' });
    const item = await db.items.get(1);
    expect(item.id).toBe(1);
    expect(item.name).toBe('A');
  });
});

describe('KVAdapter — unique indexes', () => {
  beforeEach(async () => { db = await createKVDB(); });
  afterEach(() => { db.close(); });

  it('rejects duplicate unique index values', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'same@t.com', role: 'admin', age: 30 });
    await expect(
      db.users.put({ id: 2, name: 'Bob', email: 'same@t.com', role: 'editor', age: 25 })
    ).rejects.toThrow('Key already exists');
  });

  it('allows updating same key with same email', async () => {
    await db.users.put({ id: 1, name: 'Alice', email: 'a@t.com', role: 'admin', age: 30 });
    await db.users.put({ id: 1, name: 'Alice v2', email: 'a@t.com', role: 'admin', age: 31 });
    expect((await db.users.get(1)).name).toBe('Alice v2');
  });
});

describe('KVAdapter — queries', () => {
  beforeEach(async () => {
    db = await createKVDB();
    await seedUsers(db, 10);
  });
  afterEach(() => { db.close(); });

  it('all().toArray()', async () => {
    const results = await db.users.all().toArray();
    expect(results).toHaveLength(10);
  });

  it('all().limit(3)', async () => {
    const results = await db.users.all().limit(3).toArray();
    expect(results).toHaveLength(3);
  });

  it('all().desc()', async () => {
    const results = await db.users.all().desc().toArray();
    expect(results[0].id).toBe(10);
  });

  it('all().skip(3)', async () => {
    const results = await db.users.all().skip(3).toArray();
    expect(results).toHaveLength(7);
    expect(results[0].id).toBe(4);
  });

  it('all().page(2, 3)', async () => {
    const results = await db.users.all().page(2, 3).toArray();
    expect(results.map(u => u.id)).toEqual([4, 5, 6]);
  });

  it('where(index, value)', async () => {
    const admins = await db.users.where('role', 'admin').toArray();
    expect(admins.every(u => u.role === 'admin')).toBe(true);
    expect(admins).toHaveLength(4);
  });

  it('where().gt()', async () => {
    const results = await db.users.where('age').gt(40).toArray();
    expect(results.every(u => u.age > 40)).toBe(true);
  });

  it('where().between()', async () => {
    const results = await db.users.where('age').between(26, 38).toArray();
    expect(results.every(u => u.age >= 26 && u.age <= 38)).toBe(true);
  });

  it('filter()', async () => {
    const results = await db.users.all()
      .filter(u => u.role === 'admin' && u.age > 30)
      .toArray();
    expect(results.every(u => u.role === 'admin' && u.age > 30)).toBe(true);
  });

  it('count()', async () => {
    expect(await db.users.all().count()).toBe(10);
  });

  it('first()', async () => {
    const first = await db.users.all().first();
    expect(first.id).toBe(1);
  });

  it('for-await iteration', async () => {
    const results = [];
    for await (const u of db.users.all().limit(3)) results.push(u);
    expect(results).toHaveLength(3);
  });
});

describe('KVAdapter — transactions', () => {
  beforeEach(async () => { db = await createKVDB(); });
  afterEach(() => { db.close(); });

  it('commits on success', async () => {
    await db.transaction(['users', 'config'], async (tx) => {
      await tx.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', age: 30 });
      await tx.config.put({ key: 'setup', value: true });
    });
    expect(await db.users.get(1)).toBeDefined();
    expect(await db.config.get('setup')).toBeDefined();
  });

  it('rolls back on error', async () => {
    await db.users.put({ id: 1, name: 'Original', email: 'o@t.com', role: 'admin', age: 30 });
    try {
      await db.transaction(['users'], async (tx) => {
        await tx.users.put({ id: 1, name: 'Modified', email: 'o@t.com', role: 'admin', age: 30 });
        throw new Error('rollback');
      });
    } catch (_) {}
    const user = await db.users.get(1);
    expect(user.name).toBe('Original');
  });
});

describe('KVAdapter — persistence across open()', () => {
  it('data persists when re-opened', async () => {
    kv = new MockKV();
    const adapter = new KVAdapter(kv);
    const schema = (s) => s.createStore('items', { key: 'id' });

    const db1 = await EasyDB.open('persist-test', { adapter, schema });
    await db1.items.put({ id: 1, name: 'Hello' });
    db1.close();

    const db2 = await EasyDB.open('persist-test', { adapter, schema });
    const item = await db2.items.get(1);
    expect(item.name).toBe('Hello');
    db2.close();
  });
});

describe('KVAdapter — destroy', () => {
  it('removes all data', async () => {
    kv = new MockKV();
    const adapter = new KVAdapter(kv);
    const schema = (s) => s.createStore('items', { key: 'id' });

    const db1 = await EasyDB.open('destroy-test', { adapter, schema });
    await db1.items.put({ id: 1, name: 'Hello' });
    db1.close();

    await adapter.destroy('destroy-test');

    const db2 = await EasyDB.open('destroy-test', { adapter, schema });
    expect(await db2.items.count()).toBe(0);
    db2.close();
  });
});

describe('KVAdapter — DX', () => {
  beforeEach(async () => { db = await createKVDB(); });
  afterEach(() => { db.close(); });

  it('db.stores lists store names', () => {
    expect(db.stores).toContain('users');
    expect(db.stores).toContain('config');
  });

  it('db.version', () => {
    expect(db.version).toBe(1);
  });

  it('db.store() explicit access', async () => {
    await db.store('users').put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', age: 30 });
    const user = await db.store('users').get(1);
    expect(user.name).toBe('A');
  });

  it('friendly error for missing store', async () => {
    await expect(db.nonexistent.get(1)).rejects.toThrow('not found');
  });
});
