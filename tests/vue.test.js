import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock vue before importing vue integration
let _unmountCallbacks = [];
let _watchers = [];

vi.mock('vue', () => {
  function ref(initial) {
    const r = { value: initial, __v_isRef: true };
    return r;
  }

  function isRef(val) {
    return val && val.__v_isRef === true;
  }

  function unref(val) {
    return isRef(val) ? val.value : val;
  }

  function watch(source, cb) {
    _watchers.push({ source, cb });
    return () => {};
  }

  function onUnmounted(fn) {
    _unmountCallbacks.push(fn);
  }

  return { ref, isRef, unref, watch, onUnmounted };
});

import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { useQuery, useRecord, useSyncStatus } from '../src/vue.js';
import { SyncEngine } from '../src/sync.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('Vue integration', () => {
  let db;

  beforeEach(async () => {
    _unmountCallbacks = [];
    _watchers = [];
    db = await EasyDB.open('vue-test-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('users', { key: 'id' }); },
    });
    await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await db.users.put({ id: 2, name: 'Bob', role: 'member' });
    await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
  });

  describe('useQuery()', () => {
    it('returns refs with initial loading state', () => {
      const q = useQuery(db.users);
      expect(q.loading.value).toBe(true);
      expect(q.data.value).toEqual([]);
      expect(q.error.value).toBeNull();
    });

    it('fetches data from a StoreAccessor', async () => {
      const q = useQuery(db.users);
      await tick();
      expect(q.loading.value).toBe(false);
      expect(q.data.value).toHaveLength(3);
      expect(q.error.value).toBeNull();
    });

    it('works with QueryBuilder', async () => {
      const q = useQuery(db.users.where('role', 'admin'));
      await tick();
      expect(q.data.value).toHaveLength(2);
      expect(q.data.value.every(u => u.role === 'admin')).toBe(true);
    });

    it('refresh() re-fetches data', async () => {
      const q = useQuery(db.users, { watch: false });
      await tick();
      expect(q.data.value).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      expect(q.data.value).toHaveLength(3);

      q.refresh();
      await tick();
      expect(q.data.value).toHaveLength(4);
    });

    it('auto-refreshes on mutations via watch', async () => {
      const q = useQuery(db.users);
      await tick();
      expect(q.data.value).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(q.data.value).toHaveLength(4);
    });

    it('handles errors gracefully', async () => {
      const broken = {
        toArray: () => Promise.reject(new Error('vue error')),
        [Symbol.asyncIterator]: async function* () {},
      };
      const q = useQuery(broken);
      await tick();
      expect(q.error.value).toBeInstanceOf(Error);
      expect(q.error.value.message).toBe('vue error');
      expect(q.loading.value).toBe(false);
    });

    it('registers cleanup via onUnmounted', () => {
      useQuery(db.users);
      expect(_unmountCallbacks.length).toBeGreaterThan(0);
    });

    it('cleanup stops watching', async () => {
      const q = useQuery(db.users);
      await tick();
      expect(q.data.value).toHaveLength(3);

      for (const fn of _unmountCallbacks) fn();

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(q.data.value).toHaveLength(3);
    });

    it('supports Ref input and sets up Vue watcher', () => {
      const queryRef = { value: db.users, __v_isRef: true };
      useQuery(queryRef);
      // Should have registered a Vue watch on the ref
      expect(_watchers.length).toBeGreaterThan(0);
      expect(_watchers[0].source).toBe(queryRef);
    });
  });

  describe('useRecord()', () => {
    it('fetches a single record', async () => {
      const r = useRecord(db.users, 1);
      await tick();
      expect(r.loading.value).toBe(false);
      expect(r.data.value).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    });

    it('returns undefined for missing keys', async () => {
      const r = useRecord(db.users, 999);
      await tick();
      expect(r.loading.value).toBe(false);
      expect(r.data.value).toBeUndefined();
    });

    it('auto-refreshes when the record changes', async () => {
      const r = useRecord(db.users, 1);
      await tick();
      expect(r.data.value.name).toBe('Alice');

      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin' });
      await tick(50);
      expect(r.data.value.name).toBe('Alice Updated');
    });

    it('refresh() re-fetches the record', async () => {
      const r = useRecord(db.users, 2, { watch: false });
      await tick();
      expect(r.data.value.name).toBe('Bob');

      await db.users.put({ id: 2, name: 'Bob Updated', role: 'member' });
      expect(r.data.value.name).toBe('Bob');

      r.refresh();
      await tick();
      expect(r.data.value.name).toBe('Bob Updated');
    });

    it('supports Ref key and sets up Vue watcher', () => {
      const keyRef = { value: 1, __v_isRef: true };
      useRecord(db.users, keyRef);
      expect(_watchers.some(w => w.source === keyRef)).toBe(true);
    });
  });

  describe('useSyncStatus()', () => {
    let db2, sync;

    beforeEach(async () => {
      db2 = await EasyDB.open('vue-sync-target-' + Math.random(), {
        adapter: new MemoryAdapter(),
        schema(b) { b.createStore('users', { key: 'id' }); },
      });
      sync = new SyncEngine(db, db2, {
        stores: ['users'],
        direction: 'push',
      });
    });

    it('returns reactive refs with initial status', () => {
      const s = useSyncStatus(sync);
      expect(s.running.value).toBe(false);
      expect(s.paused.value).toBe(false);
      expect(s.lastEvent.value).toBeNull();
      expect(s.error.value).toBeNull();
    });

    it('tracks sync events', async () => {
      sync.start();
      const s = useSyncStatus(sync);

      await db.users.put({ id: 10, name: 'New', role: 'test' });
      await tick(50);

      expect(s.lastEvent.value).not.toBeNull();
      expect(s.lastEvent.value.store).toBe('users');
      expect(s.lastEvent.value.type).toBe('put');

      sync.stop();
    });

    it('tracks errors', () => {
      const s = useSyncStatus(sync);

      sync._handleError(new Error('vue sync err'), { op: 'push', store: 'users' });

      expect(s.error.value).not.toBeNull();
      expect(s.error.value.err.message).toBe('vue sync err');
    });

    it('registers onUnmounted cleanup', () => {
      const before = _unmountCallbacks.length;
      useSyncStatus(sync);
      expect(_unmountCallbacks.length).toBeGreaterThan(before);
    });
  });
});
