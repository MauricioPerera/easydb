import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @angular/core before importing angular integration
let _effectFn = null;
let _destroyCallbacks = [];

vi.mock('@angular/core', () => {
  function signal(initialValue) {
    let value = initialValue;
    const s = () => value;
    s.set = (v) => { value = v; };
    s.update = (fn) => { value = fn(value); };
    s.asReadonly = () => {
      const ro = () => value;
      return ro;
    };
    return s;
  }

  function effect(fn) {
    _effectFn = fn;
    fn(); // run immediately like Angular does
    return { destroy() { _effectFn = null; } };
  }

  class DestroyRef {
    onDestroy(cb) { _destroyCallbacks.push(cb); }
  }

  function inject(token) {
    if (token === DestroyRef) {
      return new DestroyRef();
    }
    throw new Error('No provider for ' + token);
  }

  return { signal, effect, DestroyRef, inject };
});

import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { createQuery, createRecord } from '../src/angular.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('Angular integration', () => {
  let db;

  beforeEach(async () => {
    _effectFn = null;
    _destroyCallbacks = [];
    db = await EasyDB.open('angular-test-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('users', { key: 'id' }); },
    });
    await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await db.users.put({ id: 2, name: 'Bob', role: 'member' });
    await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
  });

  describe('createQuery()', () => {
    it('returns signals with initial loading state', () => {
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

    it('signals are readonly', () => {
      const q = createQuery(db.users);
      // asReadonly() returns a function without set/update
      expect(typeof q.data).toBe('function');
      expect(q.data.set).toBeUndefined();
    });

    it('handles errors gracefully', async () => {
      // Create a store accessor that has a broken query
      const broken = {
        toArray: () => Promise.reject(new Error('test error')),
        [Symbol.asyncIterator]: async function* () {},
      };
      const q = createQuery(broken);
      await tick();
      expect(q.error()).toBeInstanceOf(Error);
      expect(q.error().message).toBe('test error');
      expect(q.loading()).toBe(false);
    });

    it('supports function input for reactive queries', async () => {
      const q = createQuery(() => db.users.where('role', 'admin'));
      await tick();
      expect(q.data()).toHaveLength(2);
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

    it('registers cleanup via DestroyRef', async () => {
      createRecord(db.users, 1);
      expect(_destroyCallbacks.length).toBeGreaterThan(0);
    });
  });
});
