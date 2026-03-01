import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import EasyDB, { MemoryAdapter } from '../src/easydb.js';
import { SyncEngine } from '../src/sync.js';

// Helper: let async watchers fire
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));

const schema = s => {
  s.createStore('users', { key: 'id', indexes: ['role'] });
  s.createStore('orders', { key: 'orderId' });
};

let source, target, activeSync;

beforeEach(async () => {
  source = await EasyDB.open(`src-${Date.now()}-${Math.random()}`, { adapter: new MemoryAdapter(), schema });
  target = await EasyDB.open(`tgt-${Date.now()}-${Math.random()}`, { adapter: new MemoryAdapter(), schema });
  activeSync = null;
});

afterEach(() => {
  if (activeSync) activeSync.stop();
  source.close();
  target.close();
});

// ── Push sync ──

describe('SyncEngine — push', () => {
  it('replicates put from source to target', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    expect(await target.users.get(1)).toEqual({ id: 1, name: 'Alice', role: 'admin' });
  });

  it('replicates delete from source to target', async () => {
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await target.users.put({ id: 1, name: 'Alice', role: 'admin' });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();

    await source.users.delete(1);
    await tick();

    expect(await target.users.get(1)).toBeUndefined();
  });

  it('replicates clear from source to target', async () => {
    await target.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await target.users.put({ id: 2, name: 'Bob', role: 'user' });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();

    await source.users.clear();
    await tick();

    expect(await target.users.count()).toBe(0);
  });

  it('replicates putMany from source to target', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();

    await source.users.putMany([
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ]);
    await tick();

    expect((await target.users.getAll()).length).toBe(2);
  });

  it('only syncs configured stores', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await source.orders.put({ orderId: 'o1', total: 99 });
    await tick();

    expect(await target.users.get(1)).toBeDefined();
    expect(await target.orders.get('o1')).toBeUndefined();
  });

  it('syncs multiple stores', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users', 'orders'], direction: 'push' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();
    await source.orders.put({ orderId: 'o1', total: 99 });
    await tick();

    expect(await target.users.get(1)).toBeDefined();
    expect(await target.orders.get('o1')).toBeDefined();
  });
});

// ── Conflict resolution ──

describe('SyncEngine — conflict resolution', () => {
  it('source-wins (default)', async () => {
    await target.users.put({ id: 1, name: 'Target', role: 'user' });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push', conflict: 'source-wins' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Source', role: 'admin' });
    await tick();

    expect((await target.users.get(1)).name).toBe('Source');
  });

  it('target-wins preserves target value', async () => {
    await target.users.put({ id: 1, name: 'Target', role: 'user' });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push', conflict: 'target-wins' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Source', role: 'admin' });
    await tick();

    expect((await target.users.get(1)).name).toBe('Target');
  });

  it('last-write-wins uses timestamp field', async () => {
    await target.users.put({ id: 1, name: 'Old', role: 'user', _syncedAt: 100 });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push', conflict: 'last-write-wins' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'New', role: 'admin', _syncedAt: 200 });
    await tick();

    expect((await target.users.get(1)).name).toBe('New');
  });

  it('last-write-wins keeps target when target is newer', async () => {
    await target.users.put({ id: 1, name: 'Newer', role: 'user', _syncedAt: 300 });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push', conflict: 'last-write-wins' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Older', role: 'admin', _syncedAt: 100 });
    await tick();

    expect((await target.users.get(1)).name).toBe('Newer');
  });

  it('manual conflict resolution via onConflict', async () => {
    await target.users.put({ id: 1, name: 'Target', role: 'user', score: 50 });

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      conflict: 'manual',
      onConflict(store, key, sourceVal, targetVal) {
        return { ...sourceVal, score: targetVal.score };
      },
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Source', role: 'admin', score: 10 });
    await tick();

    const user = await target.users.get(1);
    expect(user.name).toBe('Source');
    expect(user.score).toBe(50);
  });

  it('custom timestampField', async () => {
    await target.users.put({ id: 1, name: 'Old', role: 'user', updatedAt: 100 });

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      conflict: 'last-write-wins',
      timestampField: 'updatedAt',
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'New', role: 'admin', updatedAt: 200 });
    await tick();

    expect((await target.users.get(1)).name).toBe('New');
  });
});

// ── syncAll (one-time full sync) ──

describe('SyncEngine — syncAll', () => {
  it('copies source records to target', async () => {
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await source.users.put({ id: 2, name: 'Bob', role: 'user' });

    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    await sync.syncAll();

    const all = await target.users.getAll();
    expect(all.length).toBe(2);
    expect(all.find(u => u.id === 1).name).toBe('Alice');
  });

  it('merges records from both sides in bidirectional mode', async () => {
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await target.users.put({ id: 2, name: 'Bob', role: 'user' });

    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'bidirectional' });
    await sync.syncAll();

    expect((await source.users.getAll()).length).toBe(2);
    expect((await target.users.getAll()).length).toBe(2);
  });

  it('resolves conflicts during syncAll', async () => {
    await source.users.put({ id: 1, name: 'Source', role: 'admin' });
    await target.users.put({ id: 1, name: 'Target', role: 'user' });

    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push', conflict: 'source-wins' });
    await sync.syncAll();

    expect((await target.users.get(1)).name).toBe('Source');
  });

  it('syncStore syncs a single store', async () => {
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await source.orders.put({ orderId: 'o1', total: 99 });

    const sync = new SyncEngine(source, target, { stores: ['users', 'orders'], direction: 'push' });
    await sync.syncStore('users');

    expect(await target.users.get(1)).toBeDefined();
    expect(await target.orders.get('o1')).toBeUndefined();
  });

  it('syncAll with multiple stores', async () => {
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await source.orders.put({ orderId: 'o1', total: 99 });

    const sync = new SyncEngine(source, target, { stores: ['users', 'orders'], direction: 'push' });
    await sync.syncAll();

    expect(await target.users.get(1)).toBeDefined();
    expect(await target.orders.get('o1')).toBeDefined();
  });
});

// ── Pull sync ──

describe('SyncEngine — pull', () => {
  it('pulls records from target to source on syncAll', async () => {
    await target.users.put({ id: 1, name: 'Remote', role: 'admin' });

    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'pull' });
    await sync.syncAll();

    expect(await source.users.get(1)).toEqual({ id: 1, name: 'Remote', role: 'admin' });
  });

  it('pulls records via polling', async () => {
    await target.users.put({ id: 1, name: 'Remote', role: 'admin' });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'pull', pullInterval: 30 });
    activeSync.start();

    await tick(60);

    expect(await source.users.get(1)).toEqual({ id: 1, name: 'Remote', role: 'admin' });
  });

  it('detects deletions on subsequent polls', async () => {
    await target.users.put({ id: 1, name: 'Remote', role: 'admin' });

    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'pull', pullInterval: 30 });
    activeSync.start();

    // First poll picks up the record
    await tick(60);
    expect(await source.users.get(1)).toBeDefined();

    // Delete from target
    await target.users.delete(1);

    // Second poll detects deletion
    await tick(60);
    expect(await source.users.get(1)).toBeUndefined();
  });
});

// ── Lifecycle ──

describe('SyncEngine — lifecycle', () => {
  it('running/paused state tracking', () => {
    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });

    expect(sync.running).toBe(false);
    expect(sync.paused).toBe(false);

    sync.start();
    expect(sync.running).toBe(true);
    expect(sync.paused).toBe(false);

    sync.pause();
    expect(sync.running).toBe(true);
    expect(sync.paused).toBe(true);

    sync.stop();
    expect(sync.running).toBe(false);
    expect(sync.paused).toBe(false);
  });

  it('start is idempotent', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();
    activeSync.start(); // should not double-subscribe

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    expect((await target.users.getAll()).length).toBe(1);
  });

  it('stop cleans up watchers', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();
    expect(await target.users.get(1)).toBeDefined();

    activeSync.stop();
    activeSync = null;

    await source.users.put({ id: 2, name: 'Bob', role: 'user' });
    await tick();
    expect(await target.users.get(2)).toBeUndefined();
  });

  it('pause queues events, resume flushes them', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();
    activeSync.pause();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await source.users.put({ id: 2, name: 'Bob', role: 'user' });
    await tick();

    expect(await target.users.get(1)).toBeUndefined();
    expect(await target.users.get(2)).toBeUndefined();

    await activeSync.resume();
    await tick();

    expect(await target.users.get(1)).toBeDefined();
    expect(await target.users.get(2)).toBeDefined();
  });

  it('pause without start is a no-op', () => {
    const sync = new SyncEngine(source, target, { stores: ['users'] });
    sync.pause();
    expect(sync.paused).toBe(false);
  });

  it('resume without pause is a no-op', async () => {
    activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    activeSync.start();
    await activeSync.resume(); // should not throw
  });

  it('stop without start is a no-op', () => {
    const sync = new SyncEngine(source, target, { stores: ['users'] });
    sync.stop(); // should not throw
  });
});

// ── Callbacks ──

describe('SyncEngine — callbacks', () => {
  it('onSync fires for each synced event', async () => {
    const events = [];
    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      onSync: (e) => events.push(e),
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    expect(events.length).toBe(1);
    expect(events[0].store).toBe('users');
    expect(events[0].type).toBe('put');
    expect(events[0].key).toBe(1);
  });

  it('onSync reports conflicts', async () => {
    const events = [];
    await target.users.put({ id: 1, name: 'Target', role: 'user' });

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      conflict: 'source-wins',
      onSync: (e) => events.push(e),
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Source', role: 'admin' });
    await tick();

    expect(events.find(e => e.conflict)).toBeDefined();
  });

  it('onError fires when sync fails', async () => {
    const errors = [];

    // Create a target that will fail on put
    const badTarget = await EasyDB.open(`bad-${Date.now()}`, { adapter: new MemoryAdapter(), schema });

    activeSync = new SyncEngine(source, badTarget, {
      stores: ['users'],
      direction: 'push',
      onError: (err, ctx) => errors.push({ err, ctx }),
    });
    activeSync.start();

    // Close target to cause errors
    badTarget.close();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Bidirectional ──

describe('SyncEngine — bidirectional', () => {
  it('syncs both directions via watch', async () => {
    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'bidirectional',
      pullInterval: 60000, // long interval so we test watch only
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'FromSource', role: 'admin' });
    await tick();
    expect(await target.users.get(1)).toBeDefined();

    await target.users.put({ id: 2, name: 'FromTarget', role: 'user' });
    await tick();
    expect(await source.users.get(2)).toBeDefined();
  });

  it('no conflict flag on identical values', async () => {
    const events = [];
    const value = { id: 1, name: 'Same', role: 'admin' };
    await source.users.put(value);
    await target.users.put(value);

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      onSync: (e) => events.push(e),
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Same', role: 'admin' });
    await tick();

    expect(events.filter(e => e.conflict).length).toBe(0);
  });
});

// ── Deep equality (via sync behavior) ──

describe('SyncEngine — deep equality', () => {
  it('objects with same keys in different order are treated as equal (no conflict)', async () => {
    const events = [];
    // Put records with identical values but different key order
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await target.users.put({ role: 'admin', id: 1, name: 'Alice' });

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      onSync: (e) => events.push(e),
    });
    activeSync.start();

    // Re-put the same value to trigger a watch event
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    // Should NOT have a conflict because values are deeply equal
    expect(events.filter(e => e.conflict).length).toBe(0);
  });

  it('nested objects are compared deeply (no false conflict)', async () => {
    const events = [];
    const val = { id: 1, name: 'Alice', role: 'admin', meta: { level: 5, tags: ['a', 'b'] } };
    await source.users.put(val);
    await target.users.put({ id: 1, role: 'admin', name: 'Alice', meta: { tags: ['a', 'b'], level: 5 } });

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      onSync: (e) => events.push(e),
    });
    activeSync.start();

    await source.users.put(val);
    await tick();

    expect(events.filter(e => e.conflict).length).toBe(0);
  });

  it('detects actual differences correctly (triggers conflict)', async () => {
    const events = [];
    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await target.users.put({ id: 1, name: 'Alice', role: 'user' });

    activeSync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
      conflict: 'source-wins',
      onSync: (e) => events.push(e),
    });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    expect(events.filter(e => e.conflict).length).toBe(1);
  });
});

// ── Edge cases ──

describe('SyncEngine — edge cases', () => {
  it('handles empty stores gracefully', async () => {
    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    await sync.syncAll();
    expect(await target.users.count()).toBe(0);
  });

  it('works with zero configured stores', async () => {
    activeSync = new SyncEngine(source, target, { stores: [], direction: 'push' });
    activeSync.start();

    await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await tick();

    expect(await target.users.get(1)).toBeUndefined();
  });
});

// ── Listener API ──

describe('SyncEngine — addListener', () => {
  it('multiple listeners receive events independently', async () => {
    const source = await EasyDB.open('listen-src-' + Math.random(), { adapter: new MemoryAdapter(), schema });
    const target = await EasyDB.open('listen-tgt-' + Math.random(), { adapter: new MemoryAdapter(), schema });

    const sync = new SyncEngine(source, target, {
      stores: ['users'],
      direction: 'push',
    });

    const events1 = [];
    const events2 = [];

    const unsub1 = sync.addListener({ onSync: e => events1.push(e) });
    const unsub2 = sync.addListener({ onSync: e => events2.push(e) });

    sync.start();
    await source.users.put({ id: 1, name: 'A', role: 'admin' });
    await tick(30);

    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);
    expect(events1.length).toBe(events2.length);

    // Unsubscribing one doesn't affect the other
    unsub1();
    await source.users.put({ id: 2, name: 'B', role: 'member' });
    await tick(30);

    const count1 = events1.length;
    expect(events2.length).toBeGreaterThan(count1);

    unsub2();
    sync.stop();
  });

  it('unsubscribe is idempotent', () => {
    const source = { _conn: { getKeyPath: () => 'id' } };
    const sync = new SyncEngine(source, source, { stores: [] });

    const unsub = sync.addListener({ onSync: () => {} });
    expect(sync._listeners).toHaveLength(1);

    unsub();
    expect(sync._listeners).toHaveLength(0);

    unsub(); // double-call is safe
    expect(sync._listeners).toHaveLength(0);
  });

  it('onStatusChange fires on start/stop/pause/resume', async () => {
    const source = await EasyDB.open('status-src-' + Math.random(), { adapter: new MemoryAdapter(), schema });
    const target = await EasyDB.open('status-tgt-' + Math.random(), { adapter: new MemoryAdapter(), schema });

    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    const statuses = [];
    sync.addListener({ onStatusChange: s => statuses.push({ ...s }) });

    sync.start();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual({ running: true, paused: false });

    sync.pause();
    expect(statuses).toHaveLength(2);
    expect(statuses[1]).toEqual({ running: true, paused: true });

    await sync.resume();
    expect(statuses).toHaveLength(3);
    expect(statuses[2]).toEqual({ running: true, paused: false });

    sync.stop();
    expect(statuses).toHaveLength(4);
    expect(statuses[3]).toEqual({ running: false, paused: false });
  });

  it('listener self-unsubscribe during callback does not skip others', async () => {
    const source = await EasyDB.open('safe-src-' + Math.random(), { adapter: new MemoryAdapter(), schema });
    const target = await EasyDB.open('safe-tgt-' + Math.random(), { adapter: new MemoryAdapter(), schema });

    const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
    const calls = [];
    let unsub1;

    // First listener unsubscribes itself on first call
    unsub1 = sync.addListener({
      onStatusChange: () => { calls.push('A'); unsub1(); },
    });
    // Second listener should still fire
    sync.addListener({
      onStatusChange: () => { calls.push('B'); },
    });

    sync.start();
    expect(calls).toEqual(['A', 'B']);
    sync.stop();
  });
});
