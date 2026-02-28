import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock solid-js before importing solid integration
let _cleanupFns = [];
let _effectFns = [];

vi.mock('solid-js', () => {
  function createSignal(initialValue) {
    let value = initialValue;
    const getter = () => value;
    const setter = (v) => {
      value = typeof v === 'function' ? v(value) : v;
    };
    return [getter, setter];
  }

  function createEffect(fn) {
    _effectFns.push(fn);
    fn(); // run immediately like Solid does
  }

  function onCleanup(fn) {
    _cleanupFns.push(fn);
  }

  return { createSignal, createEffect, onCleanup };
});

import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { createQuery, createRecord } from '../src/solid.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('Solid.js integration', () => {
  let db;

  beforeEach(async () => {
    _cleanupFns = [];
    _effectFns = [];
    db = await EasyDB.open('solid-test-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('users', { key: 'id' }); },
    });
    await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await db.users.put({ id: 2, name: 'Bob', role: 'member' });
    await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
  });

  describe('createQuery()', () => {
    it('returns accessors with initial loading state', () => {
      const q = createQuery(db.users);
      expect(q.loading()).toBe(true);
      expect(q.data()).toEqual([]);
      expect(q.error()).toBeNull();
    });

    it('fetches data from a StoreAccessor', async () => {
      const q = createQuery(db.users);
      await tick();
      expect(q.loading()).toBe(false);
      expect(q.data()).toHaveLength(3);
      expect(q.error()).toBeNull();
    });

    it('works with QueryBuilder', async () => {
      const q = createQuery(db.users.where('role', 'admin'));
      await tick();
      expect(q.data()).toHaveLength(2);
      expect(q.data().every(u => u.role === 'admin')).toBe(true);
    });

    it('refresh() re-fetches data', async () => {
      const q = createQuery(db.users, { watch: false });
      await tick();
      expect(q.data()).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      expect(q.data()).toHaveLength(3);

      q.refresh();
      await tick();
      expect(q.data()).toHaveLength(4);
    });

    it('auto-refreshes on mutations via watch', async () => {
      const q = createQuery(db.users);
      await tick();
      expect(q.data()).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(q.data()).toHaveLength(4);
    });

    it('registers cleanup via onCleanup', () => {
      createQuery(db.users);
      expect(_cleanupFns.length).toBeGreaterThan(0);
    });

    it('handles errors gracefully', async () => {
      const broken = {
        toArray: () => Promise.reject(new Error('solid error')),
        [Symbol.asyncIterator]: async function* () {},
      };
      const q = createQuery(broken);
      await tick();
      expect(q.error()).toBeInstanceOf(Error);
      expect(q.error().message).toBe('solid error');
      expect(q.loading()).toBe(false);
    });

    it('supports function input for reactive queries', async () => {
      const q = createQuery(() => db.users.where('role', 'admin'));
      await tick();
      expect(q.data()).toHaveLength(2);
    });

    it('cleanup stops watching', async () => {
      const q = createQuery(db.users);
      await tick();
      expect(q.data()).toHaveLength(3);

      // Run all registered cleanup fns
      for (const fn of _cleanupFns) fn();

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      // Data should NOT have updated since watcher was cleaned up
      expect(q.data()).toHaveLength(3);
    });
  });

  describe('createRecord()', () => {
    it('fetches a single record', async () => {
      const r = createRecord(db.users, 1);
      await tick();
      expect(r.loading()).toBe(false);
      expect(r.data()).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    });

    it('returns undefined for missing keys', async () => {
      const r = createRecord(db.users, 999);
      await tick();
      expect(r.loading()).toBe(false);
      expect(r.data()).toBeUndefined();
    });

    it('auto-refreshes when the record changes', async () => {
      const r = createRecord(db.users, 1);
      await tick();
      expect(r.data().name).toBe('Alice');

      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin' });
      await tick(50);
      expect(r.data().name).toBe('Alice Updated');
    });

    it('refresh() re-fetches the record', async () => {
      const r = createRecord(db.users, 2, { watch: false });
      await tick();
      expect(r.data().name).toBe('Bob');

      await db.users.put({ id: 2, name: 'Bob Updated', role: 'member' });
      expect(r.data().name).toBe('Bob');

      r.refresh();
      await tick();
      expect(r.data().name).toBe('Bob Updated');
    });

    it('supports function key for reactive lookups', async () => {
      const r = createRecord(db.users, () => 1);
      await tick();
      expect(r.data()).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    });
  });
});
