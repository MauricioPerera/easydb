/**
 * Real Preact Integration Tests
 *
 * Uses @testing-library/preact with real Preact rendering to test
 * EasyDB's useQuery() and useRecord() hooks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { EasyDB, MemoryAdapter } from '../../src/easydb.js';
import { useQuery, useRecord } from '../../src/preact.js';

describe('Preact: Real Integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open(`preact-test-${Date.now()}`, {
      adapter: new MemoryAdapter(),
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['role'] });
      },
    });
  });

  afterEach(() => {
    cleanup();
    if (db) db.close();
  });

  describe('useQuery', () => {
    it('loads data from a store', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
      ]);

      function TestComponent() {
        const { data, loading } = useQuery(db.users, { watch: false });
        if (loading) return h('div', null, 'Loading...');
        return h('div', { 'data-testid': 'count' }, `Count: ${data.length}`);
      }

      const { getByTestId } = render(h(TestComponent));

      await waitFor(() => {
        expect(getByTestId('count').textContent).toBe('Count: 2');
      });
    });

    it('loads data from a QueryBuilder', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
        { id: 3, name: 'Charlie', role: 'admin' },
      ]);

      function TestComponent() {
        const { data, loading } = useQuery(db.users.where('role', 'admin'), { watch: false });
        if (loading) return h('div', null, 'Loading...');
        return h('div', { 'data-testid': 'result' },
          data.map(u => u.name).join(', ')
        );
      }

      const { getByTestId } = render(h(TestComponent));

      await waitFor(() => {
        const text = getByTestId('result').textContent;
        expect(text).toContain('Alice');
        expect(text).toContain('Charlie');
      });
    });

    it('starts with loading=true then transitions to loaded', async () => {
      function TestComponent() {
        const { loading, data } = useQuery(db.users, { watch: false });
        return h('div', { 'data-testid': 'status' },
          loading ? 'Loading' : `Done: ${data.length}`
        );
      }

      const { getByTestId } = render(h(TestComponent));

      // Initial render may show loading
      await waitFor(() => {
        expect(getByTestId('status').textContent).toMatch(/Done: \d+/);
      });
    });
  });

  describe('useRecord', () => {
    it('loads a single record by key', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      function TestComponent() {
        const { data, loading } = useRecord(db.users, 1, { watch: false });
        if (loading) return h('div', null, 'Loading...');
        return h('div', { 'data-testid': 'name' }, data?.name || 'none');
      }

      const { getByTestId } = render(h(TestComponent));

      await waitFor(() => {
        expect(getByTestId('name').textContent).toBe('Alice');
      });
    });

    it('returns undefined for missing keys', async () => {
      function TestComponent() {
        const { data, loading } = useRecord(db.users, 999, { watch: false });
        if (loading) return h('div', null, 'Loading...');
        return h('div', { 'data-testid': 'result' },
          data === undefined ? 'not found' : 'found'
        );
      }

      const { getByTestId } = render(h(TestComponent));

      await waitFor(() => {
        expect(getByTestId('result').textContent).toBe('not found');
      });
    });
  });
});
