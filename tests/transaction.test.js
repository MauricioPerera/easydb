import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDB, destroyTestDB } from './helpers.js';

describe('Transactions', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should commit a successful transaction', async () => {
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });
    await db.users.put({ id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 });

    await db.transaction(['users'], async (tx) => {
      const a = await tx.users.get(1);
      const b = await tx.users.get(2);
      a.age += 1;
      b.age += 1;
      await tx.users.put(a);
      await tx.users.put(b);
    });

    expect((await db.users.get(1)).age).toBe(31);
    expect((await db.users.get(2)).age).toBe(26);
  });

  it('should rollback on error', async () => {
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 30 });

    try {
      await db.transaction(['users'], async (tx) => {
        const a = await tx.users.get(1);
        a.age = 99;
        await tx.users.put(a);
        throw new Error('Intentional failure');
      });
    } catch (err) {
      expect(err.message).toBe('Intentional failure');
    }

    // Should be unchanged
    expect((await db.users.get(1)).age).toBe(30);
  });

  it('should support multi-store transactions', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });

    await db.transaction(['users', 'orders'], async (tx) => {
      const user = await tx.users.get(1);
      await tx.orders.put({ orderId: 'ORD-1', userId: 1, total: 100 });
      user.name = 'Mau Updated';
      await tx.users.put(user);
    });

    expect((await db.users.get(1)).name).toBe('Mau Updated');
    expect((await db.orders.get('ORD-1')).total).toBe(100);
  });

  it('should rollback multi-store on error', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });

    try {
      await db.transaction(['users', 'orders'], async (tx) => {
        await tx.orders.put({ orderId: 'ORD-1', userId: 1, total: 100 });
        await tx.users.put({ id: 1, name: 'Changed', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });
        throw new Error('Rollback both');
      });
    } catch (_) {}

    expect((await db.users.get(1)).name).toBe('Mau');
    expect(await db.orders.get('ORD-1')).toBeUndefined();
  });

  it('should support getAll inside transaction', async () => {
    await db.users.putMany([
      { id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 },
      { id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
    ]);

    let allUsers;
    await db.transaction(['users'], async (tx) => {
      allUsers = await tx.users.getAll();
    });

    expect(allUsers).toHaveLength(2);
  });

  it('should support count inside transaction', async () => {
    await db.users.putMany([
      { id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 },
      { id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
    ]);

    let count;
    await db.transaction(['users'], async (tx) => {
      count = await tx.users.count();
    });

    expect(count).toBe(2);
  });

  it('should support delete inside transaction', async () => {
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 });

    await db.transaction(['users'], async (tx) => {
      await tx.users.delete(1);
    });

    expect(await db.users.get(1)).toBeUndefined();
  });

  it('should propagate the error from transaction callback', async () => {
    const err = await db.transaction(['users'], async () => {
      throw new TypeError('Custom type error');
    }).catch(e => e);

    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('Custom type error');
  });
});
