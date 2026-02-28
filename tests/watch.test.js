import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';
import { createTestDB, destroyTestDB, wait } from './helpers.js';

describe('Watch — reactive observation', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should emit on put', async () => {
    const events = [];
    let done = false;

    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
      done = true;
    })();

    await wait();
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('put');
    expect(events[0].key).toBe(1);
    expect(events[0].value.name).toBe('Mau');
  });

  it('should emit on delete', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });

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

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delete');
    expect(events[0].key).toBe(1);
    expect(events[0].value).toBeUndefined();
  });

  it('should emit on clear', async () => {
    await db.users.put({ id: 1, name: 'Mau', email: 'a@t.com', role: 'admin', country: 'UY', age: 35 });

    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db.users.clear();
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('clear');
  });

  it('should emit on putMany', async () => {
    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db.users.watch()) {
        events.push(evt);
        if (events.length >= 3) break;
      }
    })();

    await wait();
    await db.users.putMany([
      { id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 },
      { id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 },
      { id: 3, name: 'C', email: 'c@t.com', role: 'viewer', country: 'AR', age: 30 },
    ]);
    await watchPromise;

    expect(events).toHaveLength(3);
    expect(events.every(e => e.type === 'put')).toBe(true);
    expect(events.map(e => e.key)).toEqual([1, 2, 3]);
  });

  it('should filter by key', async () => {
    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db.users.watch({ key: 2 })) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    // This should NOT trigger the watcher (key 1)
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 });
    // This SHOULD trigger the watcher (key 2)
    await db.users.put({ id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].key).toBe(2);
  });

  it('should support multiple concurrent watchers', async () => {
    const events1 = [];
    const events2 = [];

    const w1 = (async () => {
      for await (const evt of db.users.watch()) {
        events1.push(evt);
        if (events1.length >= 2) break;
      }
    })();

    const w2 = (async () => {
      for await (const evt of db.users.watch()) {
        events2.push(evt);
        if (events2.length >= 2) break;
      }
    })();

    await wait();
    await db.users.put({ id: 1, name: 'A', email: 'a@t.com', role: 'admin', country: 'UY', age: 20 });
    await db.users.put({ id: 2, name: 'B', email: 'b@t.com', role: 'editor', country: 'MX', age: 25 });
    await Promise.all([w1, w2]);

    expect(events1).toHaveLength(2);
    expect(events2).toHaveLength(2);
  });

  it('should stop watching on break (cleanup)', async () => {
    // Verify that the async iterator's return() properly cleans up
    const watcher = db.users.watch();
    const iterator = watcher[Symbol.asyncIterator]();

    // Manually call return() — this simulates what break does
    const result = await iterator.return();
    expect(result.done).toBe(true);

    // After return(), next() should also return done
    const next = await iterator.next();
    expect(next.done).toBe(true);
  });

  it('should not emit for different stores', async () => {
    const events = [];
    let timedOut = false;

    const watchPromise = (async () => {
      const timeout = setTimeout(() => { timedOut = true; }, 100);
      for await (const evt of db.users.watch()) {
        events.push(evt);
        break;
      }
      clearTimeout(timeout);
    })();

    await wait();
    // Write to orders, not users
    await db.orders.put({ orderId: 'ORD-1', userId: 1, total: 100 });

    // The watcher should NOT have received anything
    // We need to break the watcher to avoid hanging
    await wait(150);
    // Since no events came, the watcher is still waiting
    // We can't easily break it from outside, so we write to users to break it
    await db.users.put({ id: 99, name: 'trigger', email: 'x@t.com', role: 'admin', country: 'UY', age: 1 });
    await watchPromise;

    // Should only have the trigger event, not the orders event
    expect(events).toHaveLength(1);
    expect(events[0].key).toBe(99);
  });
});

// ── Cross-tab watch (BroadcastChannel) ──────────────────

describe('Watch — cross-tab via BroadcastChannel', () => {
  const schema = (db) => {
    db.createStore('items', { key: 'id' });
  };

  it('watcher on db2 receives events from db1 mutations', async () => {
    const dbName = `crosstab-${Date.now()}`;

    // Open two separate EasyDB instances pointing at the same IDB
    const db1 = await EasyDB.open(dbName, { schema });
    const db2 = await EasyDB.open(dbName, { schema });

    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db2.items.watch()) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db1.items.put({ id: 1, value: 'from-tab-1' });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('put');
    expect(events[0].key).toBe(1);

    db1.close();
    db2.close();
    await EasyDB.destroy(dbName);
  });

  it('cross-tab events respect key filter', async () => {
    const dbName = `crosstab-filter-${Date.now()}`;
    const db1 = await EasyDB.open(dbName, { schema });
    const db2 = await EasyDB.open(dbName, { schema });

    const events = [];
    const watchPromise = (async () => {
      for await (const evt of db2.items.watch({ key: 2 })) {
        events.push(evt);
        if (events.length >= 1) break;
      }
    })();

    await wait();
    await db1.items.put({ id: 1, value: 'skip' });
    await db1.items.put({ id: 2, value: 'match' });
    await watchPromise;

    expect(events).toHaveLength(1);
    expect(events[0].key).toBe(2);

    db1.close();
    db2.close();
    await EasyDB.destroy(dbName);
  });

  it('close() stops receiving cross-tab events', async () => {
    const dbName = `crosstab-close-${Date.now()}`;
    const db1 = await EasyDB.open(dbName, { schema });
    const db2 = await EasyDB.open(dbName, { schema });

    // Start watching, then close db2
    const watcher = db2.items.watch();
    const iter = watcher[Symbol.asyncIterator]();
    await iter.return(); // clean up watcher
    db2.close();

    // Write from db1 — should not cause errors
    await db1.items.put({ id: 1, value: 'after-close' });
    await wait(50);

    db1.close();
    await EasyDB.destroy(dbName);
  });
});
