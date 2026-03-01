/**
 * Real Vue Integration Tests
 *
 * Uses @vue/test-utils with real Vue 3 rendering to test
 * EasyDB's useQuery() and useRecord() composables.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { EasyDB, MemoryAdapter } from '../../src/easydb.js';
import { useQuery, useRecord } from '../../src/vue.js';

describe('Vue: Real Integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open(`vue-test-${Date.now()}`, {
      adapter: new MemoryAdapter(),
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['role'] });
      },
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('useQuery', () => {
    it('loads data from a store', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
      ]);

      const TestComponent = defineComponent({
        setup() {
          const { data, loading } = useQuery(db.users, { watch: false });
          return { data, loading };
        },
        render() {
          if (this.loading) return h('div', 'Loading...');
          return h('div', { class: 'count' }, `Count: ${this.data.length}`);
        },
      });

      const wrapper = mount(TestComponent);
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain('Count: 2');
    });

    it('loads data from a QueryBuilder', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
        { id: 3, name: 'Charlie', role: 'admin' },
      ]);

      const TestComponent = defineComponent({
        setup() {
          const { data, loading } = useQuery(db.users.where('role', 'admin'), { watch: false });
          return { data, loading };
        },
        render() {
          if (this.loading) return h('div', 'Loading...');
          return h('div', { class: 'result' }, this.data.map(u => u.name).join(', '));
        },
      });

      const wrapper = mount(TestComponent);
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain('Alice');
      expect(wrapper.text()).toContain('Charlie');
      expect(wrapper.text()).not.toContain('Bob');
    });

    it('starts with loading=true', async () => {
      const states = [];

      const TestComponent = defineComponent({
        setup() {
          const { data, loading } = useQuery(db.users, { watch: false });
          states.push(loading.value);
          return { data, loading };
        },
        render() {
          return h('div', this.loading ? 'Loading' : 'Done');
        },
      });

      mount(TestComponent);
      expect(states[0]).toBe(true);

      await flushPromises();
      await nextTick();
    });

    it('provides a refresh function', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      let refreshFn;

      const TestComponent = defineComponent({
        setup() {
          const { data, loading, refresh } = useQuery(db.users, { watch: false });
          refreshFn = refresh;
          return { data, loading };
        },
        render() {
          if (this.loading) return h('div', 'Loading...');
          return h('div', { class: 'count' }, `Count: ${this.data.length}`);
        },
      });

      const wrapper = mount(TestComponent);
      await flushPromises();
      await nextTick();
      expect(wrapper.text()).toContain('Count: 1');

      await db.users.put({ id: 2, name: 'Bob', role: 'member' });
      refreshFn();
      await flushPromises();
      await nextTick();
      expect(wrapper.text()).toContain('Count: 2');
    });
  });

  describe('useRecord', () => {
    it('loads a single record by key', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      const TestComponent = defineComponent({
        setup() {
          const { data, loading } = useRecord(db.users, 1, { watch: false });
          return { data, loading };
        },
        render() {
          if (this.loading) return h('div', 'Loading...');
          return h('div', { class: 'name' }, this.data?.name || 'none');
        },
      });

      const wrapper = mount(TestComponent);
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toBe('Alice');
    });

    it('returns undefined for missing keys', async () => {
      const TestComponent = defineComponent({
        setup() {
          const { data, loading } = useRecord(db.users, 999, { watch: false });
          return { data, loading };
        },
        render() {
          if (this.loading) return h('div', 'Loading...');
          return h('div', this.data === undefined ? 'not found' : 'found');
        },
      });

      const wrapper = mount(TestComponent);
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toBe('not found');
    });
  });
});
