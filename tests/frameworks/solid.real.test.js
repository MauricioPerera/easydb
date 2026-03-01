/**
 * Real Solid.js Integration Tests
 *
 * Uses Solid's programmatic API (no JSX, no vite-plugin-solid) to test
 * EasyDB's createQuery() and createRecord() primitives.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'solid-js';
import { EasyDB, MemoryAdapter } from '../../src/easydb.js';
import { createQuery, createRecord } from '../../src/solid.js';

function waitFor(predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('Timeout'));
      setTimeout(check, 10);
    };
    check();
  });
}

describe('Solid.js: Real Integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open(`solid-test-${Date.now()}`, {
      adapter: new MemoryAdapter(),
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['role'] });
      },
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('createQuery', () => {
    it('loads data from a store', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
      ]);

      let queryResult;

      const dispose = createRoot(dispose => {
        queryResult = createQuery(db.users, { watch: false });
        return dispose;
      });

      expect(queryResult.loading()).toBe(true);

      await waitFor(() => !queryResult.loading());

      expect(queryResult.data()).toHaveLength(2);
      expect(queryResult.error()).toBeNull();

      dispose();
    });

    it('loads data from a QueryBuilder', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
        { id: 3, name: 'Charlie', role: 'admin' },
      ]);

      let queryResult;

      const dispose = createRoot(dispose => {
        queryResult = createQuery(db.users.where('role', 'admin'), { watch: false });
        return dispose;
      });

      await waitFor(() => !queryResult.loading());

      expect(queryResult.data()).toHaveLength(2);
      expect(queryResult.data().every(u => u.role === 'admin')).toBe(true);

      dispose();
    });

    it('provides a refresh function', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      let queryResult;

      const dispose = createRoot(dispose => {
        queryResult = createQuery(db.users, { watch: false });
        return dispose;
      });

      await waitFor(() => !queryResult.loading());
      expect(queryResult.data()).toHaveLength(1);

      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      queryResult.refresh();

      await waitFor(() => queryResult.data().length === 2);
      expect(queryResult.data()).toHaveLength(2);

      dispose();
    });
  });

  describe('createRecord', () => {
    it('loads a single record by key', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      let recordResult;

      const dispose = createRoot(dispose => {
        recordResult = createRecord(db.users, 1, { watch: false });
        return dispose;
      });

      await waitFor(() => !recordResult.loading());

      expect(recordResult.data()?.name).toBe('Alice');
      expect(recordResult.error()).toBeNull();

      dispose();
    });

    it('returns undefined for missing keys', async () => {
      let recordResult;

      const dispose = createRoot(dispose => {
        recordResult = createRecord(db.users, 999, { watch: false });
        return dispose;
      });

      await waitFor(() => !recordResult.loading());

      expect(recordResult.data()).toBeUndefined();

      dispose();
    });
  });
});
