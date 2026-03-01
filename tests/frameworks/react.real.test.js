/**
 * Real React Integration Tests
 *
 * Uses @testing-library/react with real React rendering to test
 * EasyDB's useQuery() and useRecord() hooks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { createElement } from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { EasyDB, MemoryAdapter } from '../../src/easydb.js';
import { useQuery, useRecord } from '../../src/react.js';

describe('React: Real Integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open(`react-test-${Date.now()}`, {
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

      let captured = {};

      function TestComponent() {
        const result = useQuery(db.users, { watch: false });
        captured = result;
        if (result.loading) return createElement('div', null, 'Loading...');
        return createElement('div', { 'data-testid': 'count' }, `Count: ${result.data.length}`);
      }

      const { getByTestId } = render(createElement(TestComponent));

      await waitFor(() => {
        expect(getByTestId('count').textContent).toBe('Count: 2');
      });

      expect(captured.error).toBeNull();
      expect(captured.data).toHaveLength(2);
    });

    it('loads data from a QueryBuilder', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
        { id: 3, name: 'Charlie', role: 'admin' },
      ]);

      let captured = {};

      function TestComponent() {
        const result = useQuery(db.users.where('role', 'admin'), { watch: false });
        captured = result;
        if (result.loading) return createElement('div', null, 'Loading...');
        return createElement('div', { 'data-testid': 'result' },
          result.data.map(u => u.name).join(', ')
        );
      }

      const { getByTestId } = render(createElement(TestComponent));

      await waitFor(() => {
        expect(getByTestId('result').textContent).toContain('Alice');
        expect(getByTestId('result').textContent).toContain('Charlie');
      });

      expect(captured.data).toHaveLength(2);
    });

    it('starts with loading=true then transitions to loading=false', async () => {
      const loadingStates = [];

      function TestComponent() {
        const { loading, data } = useQuery(db.users, { watch: false });
        loadingStates.push(loading);
        return createElement('div', null, loading ? 'Loading' : `Done: ${data.length}`);
      }

      render(createElement(TestComponent));

      await waitFor(() => {
        expect(loadingStates[0]).toBe(true);
        expect(loadingStates[loadingStates.length - 1]).toBe(false);
      });
    });

    it('provides a refresh function', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      let refreshFn;

      function TestComponent() {
        const { data, loading, refresh } = useQuery(db.users, { watch: false });
        refreshFn = refresh;
        if (loading) return createElement('div', null, 'Loading...');
        return createElement('div', { 'data-testid': 'count' }, `Count: ${data.length}`);
      }

      const { getByTestId } = render(createElement(TestComponent));

      await waitFor(() => {
        expect(getByTestId('count').textContent).toBe('Count: 1');
      });

      // Add another record and refresh manually
      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      act(() => { refreshFn(); });

      await waitFor(() => {
        expect(getByTestId('count').textContent).toBe('Count: 2');
      });
    });
  });

  describe('useRecord', () => {
    it('loads a single record by key', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      let captured = {};

      function TestComponent() {
        const result = useRecord(db.users, 1, { watch: false });
        captured = result;
        if (result.loading) return createElement('div', null, 'Loading...');
        return createElement('div', { 'data-testid': 'name' }, result.data?.name || 'none');
      }

      const { getByTestId } = render(createElement(TestComponent));

      await waitFor(() => {
        expect(getByTestId('name').textContent).toBe('Alice');
      });

      expect(captured.error).toBeNull();
    });

    it('returns undefined for missing keys', async () => {
      let captured = {};

      function TestComponent() {
        const result = useRecord(db.users, 999, { watch: false });
        captured = result;
        if (result.loading) return createElement('div', null, 'Loading...');
        return createElement('div', { 'data-testid': 'result' }, result.data === undefined ? 'not found' : 'found');
      }

      const { getByTestId } = render(createElement(TestComponent));

      await waitFor(() => {
        expect(getByTestId('result').textContent).toBe('not found');
      });
    });
  });
});
