import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared state tracking for mock hooks
let _states, _si, _cleanups;

vi.mock('react', () => ({
  useState(initial) {
    const idx = _si++;
    if (idx >= _states.length) _states.push(typeof initial === 'function' ? initial() : initial);
    return [_states[idx], (v) => { _states[idx] = typeof v === 'function' ? v(_states[idx]) : v; }];
  },
  useEffect(fn) {
    const cleanup = fn();
    if (typeof cleanup === 'function') _cleanups.push(cleanup);
  },
  useRef(initial) {
    return { current: initial };
  },
}));

import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { useQuery, useRecord } from '../src/react.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

/** Run a hook and return a proxy that reads live state. */
function renderHook(hookFn, ...args) {
  _si = 0; _states = []; _cleanups = [];
  const result = hookFn(...args);
  return {
    get data() { return _states[0]; },
    get loading() { return _states[1]; },
    get error() { return _states[2]; },
    get refresh() { return result.refresh; },
  };
}

describe('React integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open('react-test-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('users', { key: 'id' }); },
    });
    await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await db.users.put({ id: 2, name: 'Bob', role: 'member' });
    await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
  });

  describe('useQuery()', () => {
    it('returns initial loading state', () => {
      const result = renderHook(useQuery, db.users);
      expect(result.loading).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('fetches data from a StoreAccessor', async () => {
      const result = renderHook(useQuery, db.users);
      await tick();
      expect(result.loading).toBe(false);
      expect(result.data).toHaveLength(3);
    });

    it('works with QueryBuilder', async () => {
      const result = renderHook(useQuery, db.users.where('role', 'admin'));
      await tick();
      expect(result.data).toHaveLength(2);
      expect(result.data.every(u => u.role === 'admin')).toBe(true);
    });

    it('refresh() re-fetches data', async () => {
      const result = renderHook(useQuery, db.users, { watch: false });
      await tick();
      expect(result.data).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      expect(result.data).toHaveLength(3);

      result.refresh();
      await tick();
      expect(result.data).toHaveLength(4);
    });

    it('auto-refreshes on mutations via watch', async () => {
      const result = renderHook(useQuery, db.users);
      await tick();
      expect(result.data).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(result.data).toHaveLength(4);
    });

    it('handles errors gracefully', async () => {
      const broken = {
        toArray: () => Promise.reject(new Error('react error')),
        [Symbol.asyncIterator]: async function* () {},
      };
      const result = renderHook(useQuery, broken);
      await tick();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('react error');
      expect(result.loading).toBe(false);
    });

    it('cleanup stops watching', async () => {
      const result = renderHook(useQuery, db.users);
      await tick();
      expect(result.data).toHaveLength(3);

      for (const fn of _cleanups) fn();

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(result.data).toHaveLength(3);
    });
  });

  describe('useRecord()', () => {
    it('fetches a single record', async () => {
      const result = renderHook(useRecord, db.users, 1);
      await tick();
      expect(result.loading).toBe(false);
      expect(result.data).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    });

    it('returns undefined for missing keys', async () => {
      const result = renderHook(useRecord, db.users, 999);
      await tick();
      expect(result.loading).toBe(false);
      expect(result.data).toBeUndefined();
    });

    it('auto-refreshes when the record changes', async () => {
      const result = renderHook(useRecord, db.users, 1);
      await tick();
      expect(result.data.name).toBe('Alice');

      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin' });
      await tick(50);
      expect(result.data.name).toBe('Alice Updated');
    });

    it('refresh() re-fetches the record', async () => {
      const result = renderHook(useRecord, db.users, 2, { watch: false });
      await tick();
      expect(result.data.name).toBe('Bob');

      await db.users.put({ id: 2, name: 'Bob Updated', role: 'member' });
      expect(result.data.name).toBe('Bob');

      result.refresh();
      await tick();
      expect(result.data.name).toBe('Bob Updated');
    });
  });
});
