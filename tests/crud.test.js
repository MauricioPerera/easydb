import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDB, destroyTestDB, seedUsers } from './helpers.js';

describe('StoreAccessor — CRUD', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  // ── put / get ──

  it('should put and get a record', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'mau@t.com', role: 'admin', country: 'UY', age: 35 });
    const user = await db.users.get(1);
    expect(user).toEqual({ id: 1, name: 'Mau', email: 'mau@t.com', role: 'admin', country: 'UY', age: 35 });
  });

  it('should return undefined for non-existent key', async () => {
    const result = await db.users.get(999);
    expect(result).toBeUndefined();
  });

  it('should update an existing record with put', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });
    await db.users.put({ id: 1, name: 'Mauricio', email: 'a@t.com', role: 'admin', country: 'UY', age: 36 });
    const user = await db.users.get(1);
    expect(user.name).toBe('Mauricio');
    expect(user.age).toBe(36);
  });

  it('should store complex nested objects', async () => {
    await db.users.put({
      id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35,
      meta: { tags: ['vip', 'early'], prefs: { theme: 'dark' } }
    });
    const user = await db.users.get(1);
    expect(user.meta.tags).toEqual(['vip', 'early']);
    expect(user.meta.prefs.theme).toBe('dark');
  });

  // ── delete ──

  it('should delete a record', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });
    await db.users.delete(1);
    const result = await db.users.get(1);
    expect(result).toBeUndefined();
  });

  it('should not throw when deleting non-existent key', async () => {
    await expect(db.users.delete(999)).resolves.not.toThrow();
  });

  // ── clear ──

  it('should clear all records from a store', async () => {
    await seedUsers(db, 5);
    expect(await db.users.count()).toBe(5);
    await db.users.clear();
    expect(await db.users.count()).toBe(0);
  });

  // ── getAll ──

  it('should get all records', async () => {
    const seeded = await seedUsers(db, 5);
    const all = await db.users.getAll();
    expect(all).toHaveLength(5);
    expect(all[0].id).toBe(1);
    expect(all[4].id).toBe(5);
  });

  it('should return empty array for empty store', async () => {
    const all = await db.users.getAll();
    expect(all).toEqual([]);
  });

  // ── count ──

  it('should count records', async () => {
    await seedUsers(db, 7);
    const count = await db.users.count();
    expect(count).toBe(7);
  });

  it('should return 0 for empty store', async () => {
    expect(await db.users.count()).toBe(0);
  });

  // ── getMany ──

  it('should get multiple records by keys', async () => {
    await seedUsers(db, 5);
    const results = await db.users.getMany([1, 3, 5]);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(1);
    expect(results[1].id).toBe(3);
    expect(results[2].id).toBe(5);
  });

  it('should return undefined for missing keys in getMany', async () => {
    await seedUsers(db, 3);
    const results = await db.users.getMany([1, 99, 3]);
    expect(results[0].id).toBe(1);
    expect(results[1]).toBeUndefined();
    expect(results[2].id).toBe(3);
  });

  it('should handle empty keys array', async () => {
    const results = await db.users.getMany([]);
    expect(results).toEqual([]);
  });

  // ── putMany ──

  it('should insert multiple records', async () => {
    const items = [
      { id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 },
      { id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
      { id: 3, name: 'C', email: 'c@t.com', role: 'viewer', country: 'AR', age: 30 },
    ];
    const count = await db.users.putMany(items);
    expect(count).toBe(3);
    expect(await db.users.count()).toBe(3);
  });

  it('should upsert existing records in putMany', async () => {
    await db.users.put({ id: 1, name: 'Original', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 });
    await db.users.putMany([
      { id: 1, name: 'Updated', email: 'a@t.com', role: 'admin', country: 'UY', age: 21 },
      { id: 2, name: 'New', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
    ]);
    expect((await db.users.get(1)).name).toBe('Updated');
    expect((await db.users.get(2)).name).toBe('New');
    expect(await db.users.count()).toBe(2);
  });

  // ── Cross-store operations ──

  it('should operate on different stores independently', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });
    await db.orders.put({ orderId: 'ORD-1', userId: 1, total: 100 });

    expect(await db.users.count()).toBe(1);
    expect(await db.orders.count()).toBe(1);

    const user = await db.users.get(1);
    const order = await db.orders.get('ORD-1');
    expect(user.name).toBe('Mau');
    expect(order.total).toBe(100);
  });
});
