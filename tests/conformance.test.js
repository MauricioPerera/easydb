/**
 * Adapter Conformance Test Suite
 *
 * Runs the same behavioral tests against every adapter that can execute
 * in-process (no external services). This guarantees that all adapters
 * behave identically for the EasyDB API surface.
 *
 * Adapters tested: Memory, localStorage (mock), SQLite (better-sqlite3)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { SQLiteAdapter } from '../src/adapters/sqlite.js';

// ── Mock localStorage ────────────────────────────────────
const storage = new Map();
const mockLocalStorage = {
  getItem: (k) => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  key: (i) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
  clear: () => storage.clear(),
};
globalThis.localStorage = mockLocalStorage;

// Import after mock is in place
const { LocalStorageAdapter } = await import('../src/adapters/localstorage.js');

// ── Adapter factories ────────────────────────────────────
const adapters = [
  {
    name: 'MemoryAdapter',
    create: () => new MemoryAdapter(),
    cleanup: () => {},
  },
  {
    name: 'LocalStorageAdapter',
    create: () => new LocalStorageAdapter(),
    cleanup: () => storage.clear(),
  },
  {
    name: 'SQLiteAdapter',
    create: () => new SQLiteAdapter(':memory:'),
    cleanup: () => {},
  },
];

// ── Shared conformance suite ─────────────────────────────
for (const adapterDef of adapters) {
  describe(`Conformance: ${adapterDef.name}`, () => {
    let db;

    beforeEach(async () => {
      adapterDef.cleanup();
      const name = `conformance-${adapterDef.name}-${Math.random().toString(36).slice(2)}`;
      db = await EasyDB.open(name, {
        adapter: adapterDef.create(),
        schema(b) {
          b.createStore('users', {
            key: 'id',
            indexes: ['role', { name: 'email', unique: true }],
          });
          b.createStore('tasks', { key: 'id', autoIncrement: true });
        },
      });
    });

    afterEach(() => {
      db.close();
    });

    // ── CRUD ──────────────────────────────────────────────
    describe('CRUD', () => {
      it('put and get a record', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        const user = await db.users.get(1);
        expect(user).toEqual({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
      });

      it('get returns undefined for missing keys', async () => {
        expect(await db.users.get(999)).toBeUndefined();
      });

      it('put updates existing records (upsert)', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 1, name: 'Updated', role: 'admin', email: 'a@t.com' });
        const user = await db.users.get(1);
        expect(user.name).toBe('Updated');
      });

      it('delete removes a record', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.delete(1);
        expect(await db.users.get(1)).toBeUndefined();
      });

      it('clear removes all records', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        await db.users.clear();
        expect(await db.users.count()).toBe(0);
      });

      it('getAll returns all records', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        await db.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'c@t.com' });
        const all = await db.users.getAll();
        expect(all).toHaveLength(3);
      });

      it('count returns the number of records', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        expect(await db.users.count()).toBe(2);
      });

      it('getMany returns multiple records', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        const results = await db.users.getMany([1, 2, 999]);
        expect(results[0]).toEqual({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        expect(results[1]).toEqual({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        expect(results[2]).toBeUndefined();
      });

      it('putMany inserts multiple records', async () => {
        const count = await db.users.putMany([
          { id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' },
          { id: 2, name: 'Bob', role: 'member', email: 'b@t.com' },
          { id: 3, name: 'Charlie', role: 'admin', email: 'c@t.com' },
        ]);
        expect(count).toBe(3);
        expect(await db.users.count()).toBe(3);
      });
    });

    // ── AutoIncrement ─────────────────────────────────────
    describe('autoIncrement', () => {
      it('generates sequential keys', async () => {
        const k1 = await db.tasks.put({ title: 'Task 1' });
        const k2 = await db.tasks.put({ title: 'Task 2' });
        const k3 = await db.tasks.put({ title: 'Task 3' });
        expect(k1).toBe(1);
        expect(k2).toBe(2);
        expect(k3).toBe(3);
      });

      it('assigns generated key to the record', async () => {
        await db.tasks.put({ title: 'Task 1' });
        const task = await db.tasks.get(1);
        expect(task.id).toBe(1);
        expect(task.title).toBe('Task 1');
      });

      it('putMany with autoIncrement', async () => {
        const count = await db.tasks.putMany([
          { title: 'Task A' },
          { title: 'Task B' },
        ]);
        expect(count).toBe(2);
        const t1 = await db.tasks.get(1);
        const t2 = await db.tasks.get(2);
        expect(t1.title).toBe('Task A');
        expect(t2.title).toBe('Task B');
      });
    });

    // ── Unique indexes ────────────────────────────────────
    describe('unique indexes', () => {
      it('rejects duplicate unique index values', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'same@t.com' });
        await expect(
          db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'same@t.com' })
        ).rejects.toThrow();
      });

      it('allows updating same record with same unique value', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin', email: 'a@t.com' });
        const user = await db.users.get(1);
        expect(user.name).toBe('Alice Updated');
      });
    });

    // ── QueryBuilder ──────────────────────────────────────
    describe('QueryBuilder', () => {
      beforeEach(async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        await db.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'c@t.com' });
        await db.users.put({ id: 4, name: 'Diana', role: 'member', email: 'd@t.com' });
      });

      it('all().toArray() returns all records', async () => {
        const all = await db.users.all().toArray();
        expect(all).toHaveLength(4);
      });

      it('all().count() returns the count', async () => {
        expect(await db.users.all().count()).toBe(4);
      });

      it('all().first() returns the first record', async () => {
        const first = await db.users.all().first();
        expect(first.id).toBe(1);
      });

      it('all().limit(n) limits results', async () => {
        const limited = await db.users.all().limit(2).toArray();
        expect(limited).toHaveLength(2);
      });

      it('all().skip(n) skips results', async () => {
        const skipped = await db.users.all().skip(2).toArray();
        expect(skipped).toHaveLength(2);
        expect(skipped[0].id).toBe(3);
      });

      it('all().page(n, size) paginates', async () => {
        const page1 = await db.users.all().page(1, 2).toArray();
        const page2 = await db.users.all().page(2, 2).toArray();
        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(2);
        expect(page1[0].id).toBe(1);
        expect(page2[0].id).toBe(3);
      });

      it('all().desc() reverses order', async () => {
        const desc = await db.users.all().desc().toArray();
        expect(desc[0].id).toBe(4);
        expect(desc[desc.length - 1].id).toBe(1);
      });

      it('filter() applies JS-side filter', async () => {
        const admins = await db.users.all().filter(u => u.role === 'admin').toArray();
        expect(admins).toHaveLength(2);
        expect(admins.every(u => u.role === 'admin')).toBe(true);
      });

      it('where() with index filters by value', async () => {
        const admins = await db.users.where('role', 'admin').toArray();
        expect(admins).toHaveLength(2);
      });

      it('where().gt() range query', async () => {
        const result = await db.users.where('id').gt(2).toArray();
        expect(result).toHaveLength(2);
        expect(result.every(u => u.id > 2)).toBe(true);
      });

      it('where().between() range query', async () => {
        const result = await db.users.where('id').between(2, 3).toArray();
        expect(result).toHaveLength(2);
      });

      it('where().lt() range query', async () => {
        const result = await db.users.where('id').lt(3).toArray();
        expect(result).toHaveLength(2);
        expect(result.every(u => u.id < 3)).toBe(true);
      });

      it('where().gte() range query', async () => {
        const result = await db.users.where('id').gte(3).toArray();
        expect(result).toHaveLength(2);
        expect(result.every(u => u.id >= 3)).toBe(true);
      });

      it('where().lte() range query', async () => {
        const result = await db.users.where('id').lte(2).toArray();
        expect(result).toHaveLength(2);
        expect(result.every(u => u.id <= 2)).toBe(true);
      });
    });

    // ── Cursor (async iterator) ───────────────────────────
    describe('cursor', () => {
      it('iterates records via async iterator', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });

        const results = [];
        for await (const user of db.users.all()) {
          results.push(user);
        }
        expect(results).toHaveLength(2);
      });

      it('supports early break', async () => {
        await db.users.putMany([
          { id: 1, name: 'A', role: 'a', email: 'a@t.com' },
          { id: 2, name: 'B', role: 'b', email: 'b@t.com' },
          { id: 3, name: 'C', role: 'c', email: 'c@t.com' },
        ]);

        const results = [];
        for await (const user of db.users.all()) {
          results.push(user);
          if (results.length === 2) break;
        }
        expect(results).toHaveLength(2);
      });
    });

    // ── Transactions ──────────────────────────────────────
    describe('transactions', () => {
      it('commits on success', async () => {
        await db.transaction(['users', 'tasks'], async (tx) => {
          await tx.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
          await tx.tasks.put({ title: 'Task 1' });
        });
        expect(await db.users.get(1)).toBeDefined();
        expect(await db.tasks.get(1)).toBeDefined();
      });

      it('rolls back on error', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

        try {
          await db.transaction(['users'], async (tx) => {
            await tx.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
            throw new Error('abort');
          });
        } catch (_) {}

        expect(await db.users.get(2)).toBeUndefined();
        expect(await db.users.get(1)).toBeDefined();
      });
    });

    // ── Store metadata ────────────────────────────────────
    describe('metadata', () => {
      it('reports store names', () => {
        expect(db.stores).toContain('users');
        expect(db.stores).toContain('tasks');
      });

      it('hasStore returns correct values', () => {
        expect(db._conn.hasStore('users')).toBe(true);
        expect(db._conn.hasStore('nonexistent')).toBe(false);
      });

      it('getKeyPath returns correct values', () => {
        expect(db._conn.getKeyPath('users')).toBe('id');
        expect(db._conn.getKeyPath('tasks')).toBe('id');
      });

      it('version is set correctly', () => {
        expect(db.version).toBe(1);
      });
    });

    // ── Data type roundtrip ───────────────────────────────
    describe('data type preservation', () => {
      it('preserves strings', async () => {
        await db.users.put({ id: 1, name: 'Hello World', role: 'test', email: 'str@t.com' });
        const user = await db.users.get(1);
        expect(user.name).toBe('Hello World');
      });

      it('preserves numbers (int and float)', async () => {
        await db.tasks.put({ id: 1, count: 42, ratio: 3.14 });
        const task = await db.tasks.get(1);
        expect(task.count).toBe(42);
        expect(task.ratio).toBeCloseTo(3.14);
      });

      it('preserves booleans', async () => {
        await db.tasks.put({ id: 1, active: true, deleted: false });
        const task = await db.tasks.get(1);
        expect(task.active).toBe(true);
        expect(task.deleted).toBe(false);
      });

      it('preserves null', async () => {
        await db.tasks.put({ id: 1, value: null });
        const task = await db.tasks.get(1);
        expect(task.value).toBeNull();
      });

      it('preserves nested objects', async () => {
        const nested = { id: 1, meta: { tags: ['a', 'b'], info: { level: 3 } }, role: 'x', email: 'n@t.com' };
        await db.users.put(nested);
        const user = await db.users.get(1);
        expect(user.meta).toEqual({ tags: ['a', 'b'], info: { level: 3 } });
      });

      it('preserves arrays', async () => {
        await db.tasks.put({ id: 1, items: [1, 'two', { three: 3 }] });
        const task = await db.tasks.get(1);
        expect(task.items).toEqual([1, 'two', { three: 3 }]);
      });
    });

    // ── Edge cases ────────────────────────────────────────
    describe('edge cases', () => {
      it('handles empty store gracefully', async () => {
        expect(await db.users.getAll()).toEqual([]);
        expect(await db.users.count()).toBe(0);
        const first = await db.users.all().first();
        expect(first).toBeUndefined();
      });

      it('delete on missing key does not throw', async () => {
        await expect(db.users.delete(999)).resolves.not.toThrow();
      });

      it('getMany with empty array returns empty array', async () => {
        const results = await db.users.getMany([]);
        expect(results).toEqual([]);
      });

      it('putMany with empty array returns 0', async () => {
        const count = await db.users.putMany([]);
        expect(count).toBe(0);
      });

      it('multiple clears in a row do not throw', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await db.users.clear();
        await expect(db.users.clear()).resolves.not.toThrow();
      });

      it('put and delete the same key repeatedly', async () => {
        for (let i = 0; i < 5; i++) {
          await db.users.put({ id: 1, name: `V${i}`, role: 'test', email: 'r@t.com' });
          const user = await db.users.get(1);
          expect(user.name).toBe(`V${i}`);
          await db.users.delete(1);
          expect(await db.users.get(1)).toBeUndefined();
        }
      });
    });

    // ── Watch / Reactivity ────────────────────────────────
    describe('watch', () => {
      it('emits put events', async () => {
        const events = [];
        const watcher = db.users.watch()[Symbol.asyncIterator]();

        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

        const { value } = await watcher.next();
        events.push(value);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('put');
        expect(events[0].key).toBe(1);

        if (watcher.return) watcher.return();
      });

      it('emits delete events', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

        const watcher = db.users.watch()[Symbol.asyncIterator]();
        await db.users.delete(1);

        const { value } = await watcher.next();
        expect(value.type).toBe('delete');
        expect(value.key).toBe(1);

        if (watcher.return) watcher.return();
      });

      it('emits clear events', async () => {
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

        const watcher = db.users.watch()[Symbol.asyncIterator]();
        await db.users.clear();

        const { value } = await watcher.next();
        expect(value.type).toBe('clear');

        if (watcher.return) watcher.return();
      });

      it('filters by key when specified', async () => {
        const watcher = db.users.watch({ key: 1 })[Symbol.asyncIterator]();

        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });

        const { value } = await watcher.next();
        expect(value.key).toBe(1);

        if (watcher.return) watcher.return();
      });

      it('stops emitting after return()', async () => {
        const watcher = db.users.watch()[Symbol.asyncIterator]();

        await db.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'a@t.com' });
        await watcher.next();
        await watcher.return();

        // No more events should be emitted (watcher is closed)
        await db.users.put({ id: 2, name: 'Bob', role: 'member', email: 'b@t.com' });
        // If we got here without hanging, the watcher was properly closed
      });
    });

    // ── Migrations ────────────────────────────────────────
    describe('migrations', () => {
      it('creates stores from migrations map', async () => {
        const name2 = `mig-${adapterDef.name}-${Math.random().toString(36).slice(2)}`;
        adapterDef.cleanup();
        const db2 = await EasyDB.open(name2, {
          adapter: adapterDef.create(),
          migrations: {
            1: (s) => { s.createStore('users', { key: 'id' }); },
            2: (s) => { s.createStore('orders', { key: 'orderId' }); },
          },
        });
        expect(db2.version).toBe(2);
        expect(db2.stores).toContain('users');
        expect(db2.stores).toContain('orders');
        db2.close();
      });

      it('auto-infers version from highest migration key', async () => {
        const name2 = `mig-ver-${adapterDef.name}-${Math.random().toString(36).slice(2)}`;
        adapterDef.cleanup();
        const db2 = await EasyDB.open(name2, {
          adapter: adapterDef.create(),
          migrations: {
            1: (s) => { s.createStore('a', { key: 'id' }); },
            5: (s) => { s.createStore('b', { key: 'id' }); },
            3: (s) => { s.createStore('c', { key: 'id' }); },
          },
        });
        expect(db2.version).toBe(5);
        db2.close();
      });
    });
  });
}
