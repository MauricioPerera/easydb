import { describe, it, expect, beforeEach } from 'vitest';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { queryStore, recordStore, syncStatusStore } from '../src/svelte.js';
import { SyncEngine } from '../src/sync.js';

// Helper: wait for async effects to settle
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('Svelte integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open('svelte-test-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('users', { key: 'id' }); },
    });
    await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await db.users.put({ id: 2, name: 'Bob', role: 'member' });
    await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
  });

  describe('queryStore()', () => {
    it('emits initial data on subscribe', async () => {
      const store = queryStore(db.users);
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.loading).toBe(false);
      expect(state.data).toHaveLength(3);
      expect(state.error).toBeNull();
      unsub();
    });

    it('works with QueryBuilder', async () => {
      const store = queryStore(db.users.where('role', 'admin'));
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.data).toHaveLength(2);
      expect(state.data.every(u => u.role === 'admin')).toBe(true);
      unsub();
    });

    it('starts with loading=true', () => {
      const store = queryStore(db.users);
      let state;
      const unsub = store.subscribe(s => { state = s; });
      // Synchronous first call should have loading=true
      expect(state.loading).toBe(true);
      unsub();
    });

    it('refresh() re-fetches data', async () => {
      const store = queryStore(db.users, { watch: false });
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.data).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'admin' });
      // Not yet updated (watch disabled)
      expect(state.data).toHaveLength(3);

      store.refresh();
      await tick();
      expect(state.data).toHaveLength(4);
      unsub();
    });

    it('auto-refreshes on mutations via watch', async () => {
      const store = queryStore(db.users, { watch: true });
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.data).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(state.data).toHaveLength(4);
      unsub();
    });

    it('stops watching when unsubscribed', async () => {
      const store = queryStore(db.users);
      let callCount = 0;
      const unsub = store.subscribe(() => { callCount++; });
      await tick();
      const countBefore = callCount;
      unsub();

      // Mutation after unsub should not trigger re-fetch
      await db.users.put({ id: 5, name: 'Eve', role: 'admin' });
      await tick(50);
      expect(callCount).toBe(countBefore);
    });

    it('notifies multiple subscribers', async () => {
      const store = queryStore(db.users, { watch: false });
      let s1, s2;
      const unsub1 = store.subscribe(s => { s1 = s; });
      const unsub2 = store.subscribe(s => { s2 = s; });
      await tick();
      expect(s1.data).toHaveLength(3);
      expect(s2.data).toHaveLength(3);
      expect(s1).toEqual(s2);
      unsub1();
      unsub2();
    });
  });

  describe('recordStore()', () => {
    it('fetches a single record', async () => {
      const store = recordStore(db.users, 1);
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.loading).toBe(false);
      expect(state.data).toEqual({ id: 1, name: 'Alice', role: 'admin' });
      unsub();
    });

    it('returns undefined for missing keys', async () => {
      const store = recordStore(db.users, 999);
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.loading).toBe(false);
      expect(state.data).toBeUndefined();
      unsub();
    });

    it('auto-refreshes when the record changes', async () => {
      const store = recordStore(db.users, 1);
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.data.name).toBe('Alice');

      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin' });
      await tick(50);
      expect(state.data.name).toBe('Alice Updated');
      unsub();
    });

    it('refresh() re-fetches the record', async () => {
      const store = recordStore(db.users, 2, { watch: false });
      let state;
      const unsub = store.subscribe(s => { state = s; });
      await tick();
      expect(state.data.name).toBe('Bob');

      await db.users.put({ id: 2, name: 'Bob Updated', role: 'member' });
      expect(state.data.name).toBe('Bob');

      store.refresh();
      await tick();
      expect(state.data.name).toBe('Bob Updated');
      unsub();
    });
  });

  describe('syncStatusStore()', () => {
    let db2, sync;

    beforeEach(async () => {
      db2 = await EasyDB.open('svelte-sync-target-' + Math.random(), {
        adapter: new MemoryAdapter(),
        schema(b) { b.createStore('users', { key: 'id' }); },
      });
      sync = new SyncEngine(db, db2, {
        stores: ['users'],
        direction: 'push',
      });
    });

    it('emits initial status on subscribe', () => {
      const store = syncStatusStore(sync);
      let state;
      const unsub = store.subscribe(s => { state = s; });
      expect(state.running).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.lastEvent).toBeNull();
      expect(state.error).toBeNull();
      unsub();
    });

    it('tracks sync events', async () => {
      sync.start();
      const store = syncStatusStore(sync);
      let state;
      const unsub = store.subscribe(s => { state = s; });

      await db.users.put({ id: 10, name: 'New', role: 'test' });
      await tick(50);

      expect(state.lastEvent).not.toBeNull();
      expect(state.lastEvent.store).toBe('users');
      expect(state.lastEvent.type).toBe('put');

      unsub();
      sync.stop();
    });

    it('tracks errors', () => {
      const store = syncStatusStore(sync);
      let state;
      const unsub = store.subscribe(s => { state = s; });

      sync._handleError(new Error('svelte sync err'), { op: 'push', store: 'users' });

      expect(state.error).not.toBeNull();
      expect(state.error.err.message).toBe('svelte sync err');
      unsub();
    });

    it('cleans up on unsubscribe', () => {
      const store = syncStatusStore(sync);
      const unsub = store.subscribe(() => {});
      unsub();
      // After unsub, listener should be removed
      expect(sync._listeners).toHaveLength(0);
    });
  });
});
