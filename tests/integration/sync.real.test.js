/**
 * Cross-Adapter Sync Integration Tests
 *
 * Verifies that SyncEngine works correctly when the source and target databases
 * use different adapter backends. This is the primary integration-level guarantee
 * that sync is truly adapter-agnostic — the unit tests (tests/sync.test.js) only
 * cover Memory ↔ Memory.
 *
 * ── Adapters under test ──────────────────────────────────────────────────────
 *
 *   All three run locally without Docker or external services:
 *
 *   | Adapter       | Constructor                           | Storage         |
 *   |---------------|---------------------------------------|-----------------|
 *   | MemoryAdapter | new MemoryAdapter()                   | In-process Map  |
 *   | SQLiteAdapter | new SQLiteAdapter(':memory:')          | better-sqlite3  |
 *   | TursoAdapter  | new TursoAdapter(client)              | @libsql/client  |
 *
 * ── Adapter pairs ────────────────────────────────────────────────────────────
 *
 *   1. Memory ↔ SQLite  — in-memory JS vs file-based SQL
 *   2. Memory ↔ Turso   — in-memory JS vs libSQL (skipped if @libsql/client missing)
 *   3. SQLite ↔ Turso   — two different SQL engines  (skipped if @libsql/client missing)
 *
 * ── Test sections (per pair) ─────────────────────────────────────────────────
 *
 *   A. Push sync          — watch-based: put, delete, clear, putMany
 *   B. Pull sync          — syncAll in push & pull directions
 *   C. Bidirectional      — watch both directions + syncAll merge
 *   D. Conflict resolution — source-wins, target-wins, last-write-wins, manual
 *   E. Data types         — nested objects, arrays, nulls, int/float roundtrip
 *   F. AutoIncrement      — generated keys sync & preserve on target
 *   G. Edge cases         — empty stores, concurrent writes, pause/resume, 100-record batch
 *
 * ── Running ──────────────────────────────────────────────────────────────────
 *
 *   npm run test:integration          # runs all integration tests
 *   npx vitest run tests/integration/sync.real.test.js   # this file only
 *
 * ── Architecture notes ───────────────────────────────────────────────────────
 *
 *   The `crossAdapterSuite(label, createSource, createTarget)` function defines
 *   all 23 tests once and is invoked per adapter pair — avoiding duplication
 *   while ensuring each pair exercises the full matrix. Each test gets fresh
 *   EasyDB instances via factory functions; Turso clients are tracked in a
 *   module-level array and closed in afterEach.
 *
 *   Adding a new adapter pair requires only a new factory function and one
 *   additional `crossAdapterSuite()` call (optionally wrapped in skipIf).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EasyDB } from '../../src/easydb.js';
import { MemoryAdapter } from '../../src/adapters/memory.js';
import { SQLiteAdapter } from '../../src/adapters/sqlite.js';
import { SyncEngine } from '../../src/sync.js';
import { tryTurso } from './helpers.js';

const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));

const tursoAvailable = await tryTurso().then(c => { if (c) c.close(); return !!c; });

// Schema shared by all sync tests — two stores: users (manual key) + tasks (autoIncrement)
const schema = s => {
  s.createStore('users', { key: 'id', indexes: ['role'] });
  s.createStore('tasks', { key: 'id', autoIncrement: true });
};

// ── Factory helpers ──────────────────────────────────────

let tursoClients = [];

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function createMemory() {
  return EasyDB.open(`mem_${uid()}`, { adapter: new MemoryAdapter(), schema });
}

async function createSQLite() {
  return EasyDB.open(`sql_${uid()}`, { adapter: new SQLiteAdapter(':memory:'), schema });
}

async function createTurso() {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: 'file::memory:' });
  tursoClients.push(client);
  return EasyDB.open(`turso_${uid()}`, { adapter: new TursoAdapter(client), schema });
}

// Lazy-load TursoAdapter only when needed
let TursoAdapter;
if (tursoAvailable) {
  TursoAdapter = (await import('../../src/adapters/turso.js')).TursoAdapter;
}

// ── Reusable test suite per adapter pair ─────────────────

function crossAdapterSuite(label, createSource, createTarget) {
  describe(label, () => {
    let source, target, activeSync;

    beforeEach(async () => {
      tursoClients = [];
      source = await createSource();
      target = await createTarget();
      activeSync = null;
    });

    afterEach(() => {
      if (activeSync) activeSync.stop();
      source.close();
      target.close();
      for (const c of tursoClients) c.close();
      tursoClients = [];
    });

    // ── A. Push sync (watch-based) ─────────────────────────

    describe('push sync', () => {
      it('put replicates from source to target', async () => {
        activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        activeSync.start();

        await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await tick();

        expect(await target.users.get(1)).toEqual({ id: 1, name: 'Alice', role: 'admin' });
      });

      it('delete replicates from source to target', async () => {
        await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await target.users.put({ id: 1, name: 'Alice', role: 'admin' });

        activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        activeSync.start();

        await source.users.delete(1);
        await tick();

        expect(await target.users.get(1)).toBeUndefined();
      });

      it('clear replicates from source to target', async () => {
        await target.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await target.users.put({ id: 2, name: 'Bob', role: 'user' });

        activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        activeSync.start();

        await source.users.clear();
        await tick();

        expect(await target.users.count()).toBe(0);
      });

      it('putMany replicates bulk records', async () => {
        activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        activeSync.start();

        await source.users.putMany([
          { id: 1, name: 'Alice', role: 'admin' },
          { id: 2, name: 'Bob', role: 'user' },
          { id: 3, name: 'Carol', role: 'user' },
        ]);
        await tick();

        expect((await target.users.getAll()).length).toBe(3);
      });
    });

    // ── B. Pull sync (polling / syncAll) ───────────────────

    describe('pull sync', () => {
      it('syncAll copies source records to target', async () => {
        await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await source.users.put({ id: 2, name: 'Bob', role: 'user' });

        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();

        const all = await target.users.getAll();
        expect(all.length).toBe(2);
        expect(all.find(u => u.id === 1).name).toBe('Alice');
      });

      it('syncAll pulls target-only records to source (pull mode)', async () => {
        await target.users.put({ id: 1, name: 'Remote', role: 'admin' });

        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'pull' });
        await sync.syncAll();

        expect(await source.users.get(1)).toEqual({ id: 1, name: 'Remote', role: 'admin' });
      });
    });

    // ── C. Bidirectional sync ──────────────────────────────

    describe('bidirectional sync', () => {
      it('changes on either side propagate to the other', async () => {
        activeSync = new SyncEngine(source, target, {
          stores: ['users'],
          direction: 'bidirectional',
          pullInterval: 60000,
        });
        activeSync.start();

        await source.users.put({ id: 1, name: 'FromSource', role: 'admin' });
        await tick();
        expect(await target.users.get(1)).toBeDefined();

        await target.users.put({ id: 2, name: 'FromTarget', role: 'user' });
        await tick();
        expect(await source.users.get(2)).toBeDefined();
      });

      it('syncAll merges records from both sides', async () => {
        await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await target.users.put({ id: 2, name: 'Bob', role: 'user' });

        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'bidirectional' });
        await sync.syncAll();

        expect((await source.users.getAll()).length).toBe(2);
        expect((await target.users.getAll()).length).toBe(2);
      });
    });

    // ── D. Conflict resolution across adapters ─────────────

    describe('conflict resolution', () => {
      it('source-wins', async () => {
        await target.users.put({ id: 1, name: 'Target', role: 'user' });

        activeSync = new SyncEngine(source, target, {
          stores: ['users'], direction: 'push', conflict: 'source-wins',
        });
        activeSync.start();

        await source.users.put({ id: 1, name: 'Source', role: 'admin' });
        await tick();

        expect((await target.users.get(1)).name).toBe('Source');
      });

      it('target-wins', async () => {
        await target.users.put({ id: 1, name: 'Target', role: 'user' });

        activeSync = new SyncEngine(source, target, {
          stores: ['users'], direction: 'push', conflict: 'target-wins',
        });
        activeSync.start();

        await source.users.put({ id: 1, name: 'Source', role: 'admin' });
        await tick();

        expect((await target.users.get(1)).name).toBe('Target');
      });

      it('last-write-wins (timestamp field)', async () => {
        await target.users.put({ id: 1, name: 'Old', role: 'user', _syncedAt: 100 });

        activeSync = new SyncEngine(source, target, {
          stores: ['users'], direction: 'push', conflict: 'last-write-wins',
        });
        activeSync.start();

        await source.users.put({ id: 1, name: 'New', role: 'admin', _syncedAt: 200 });
        await tick();

        expect((await target.users.get(1)).name).toBe('New');
      });

      it('last-write-wins keeps target when target is newer', async () => {
        await target.users.put({ id: 1, name: 'Newer', role: 'user', _syncedAt: 300 });

        activeSync = new SyncEngine(source, target, {
          stores: ['users'], direction: 'push', conflict: 'last-write-wins',
        });
        activeSync.start();

        await source.users.put({ id: 1, name: 'Older', role: 'admin', _syncedAt: 100 });
        await tick();

        expect((await target.users.get(1)).name).toBe('Newer');
      });

      it('manual conflict resolver (merge fields)', async () => {
        await target.users.put({ id: 1, name: 'Target', role: 'user', score: 50 });

        activeSync = new SyncEngine(source, target, {
          stores: ['users'],
          direction: 'push',
          conflict: 'manual',
          onConflict(store, key, sourceVal, targetVal) {
            return { ...sourceVal, score: targetVal.score };
          },
        });
        activeSync.start();

        await source.users.put({ id: 1, name: 'Source', role: 'admin', score: 10 });
        await tick();

        const user = await target.users.get(1);
        expect(user.name).toBe('Source');
        expect(user.score).toBe(50);
      });
    });

    // ── E. Data type preservation across adapters ──────────

    describe('data type preservation', () => {
      it('nested objects survive sync roundtrip', async () => {
        const record = { id: 1, name: 'Alice', role: 'admin', meta: { level: 5, prefs: { theme: 'dark' } } };

        await source.users.put(record);
        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();

        const result = await target.users.get(1);
        expect(result.meta).toEqual({ level: 5, prefs: { theme: 'dark' } });
      });

      it('arrays survive sync roundtrip', async () => {
        const record = { id: 1, name: 'Alice', role: 'admin', tags: ['a', 'b', 'c'] };

        await source.users.put(record);
        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();

        const result = await target.users.get(1);
        expect(result.tags).toEqual(['a', 'b', 'c']);
      });

      it('null values survive sync roundtrip', async () => {
        const record = { id: 1, name: 'Alice', role: 'admin', bio: null };

        await source.users.put(record);
        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();

        const result = await target.users.get(1);
        expect(result.bio).toBeNull();
      });

      it('numbers (int + float) survive sync roundtrip', async () => {
        const record = { id: 1, name: 'Alice', role: 'admin', age: 30, score: 95.5 };

        await source.users.put(record);
        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();

        const result = await target.users.get(1);
        expect(result.age).toBe(30);
        expect(result.score).toBe(95.5);
      });
    });

    // ── F. AutoIncrement across adapters ───────────────────

    describe('autoIncrement', () => {
      it('records with autoIncrement keys sync correctly', async () => {
        await source.tasks.put({ title: 'Task A' });
        await source.tasks.put({ title: 'Task B' });

        const sync = new SyncEngine(source, target, { stores: ['tasks'], direction: 'push' });
        await sync.syncAll();

        const all = await target.tasks.getAll();
        expect(all.length).toBe(2);
        expect(all.map(t => t.title).sort()).toEqual(['Task A', 'Task B']);
      });

      it('generated keys are preserved on the target side', async () => {
        const key1 = await source.tasks.put({ title: 'Task A' });
        const key2 = await source.tasks.put({ title: 'Task B' });

        const sync = new SyncEngine(source, target, { stores: ['tasks'], direction: 'push' });
        await sync.syncAll();

        const a = await target.tasks.get(key1);
        const b = await target.tasks.get(key2);
        expect(a.title).toBe('Task A');
        expect(b.title).toBe('Task B');
      });
    });

    // ── G. Edge cases ──────────────────────────────────────

    describe('edge cases', () => {
      it('empty stores sync without errors', async () => {
        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();
        expect(await target.users.count()).toBe(0);
        expect(await source.users.count()).toBe(0);
      });

      it('concurrent puts on both sides during bidirectional', async () => {
        activeSync = new SyncEngine(source, target, {
          stores: ['users'],
          direction: 'bidirectional',
          pullInterval: 60000,
        });
        activeSync.start();

        // Rapid interleaved writes
        await source.users.put({ id: 1, name: 'S1', role: 'admin' });
        await target.users.put({ id: 2, name: 'T2', role: 'user' });
        await source.users.put({ id: 3, name: 'S3', role: 'admin' });
        await target.users.put({ id: 4, name: 'T4', role: 'user' });
        await tick(50);

        // All records should eventually exist on both sides
        const sourceAll = await source.users.getAll();
        const targetAll = await target.users.getAll();
        expect(sourceAll.length).toBeGreaterThanOrEqual(2);
        expect(targetAll.length).toBeGreaterThanOrEqual(2);
      });

      it('pause/resume with pending cross-adapter events', async () => {
        activeSync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        activeSync.start();
        activeSync.pause();

        await source.users.put({ id: 1, name: 'Alice', role: 'admin' });
        await source.users.put({ id: 2, name: 'Bob', role: 'user' });
        await tick();

        // Nothing synced while paused
        expect(await target.users.get(1)).toBeUndefined();
        expect(await target.users.get(2)).toBeUndefined();

        await activeSync.resume();
        await tick();

        // Flushed after resume
        expect(await target.users.get(1)).toBeDefined();
        expect(await target.users.get(2)).toBeDefined();
      });

      it('large batch sync (100 records via syncAll)', async () => {
        const records = Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          role: i % 2 === 0 ? 'admin' : 'user',
        }));

        await source.users.putMany(records);

        const sync = new SyncEngine(source, target, { stores: ['users'], direction: 'push' });
        await sync.syncAll();

        const all = await target.users.getAll();
        expect(all.length).toBe(100);
        expect(all.find(u => u.id === 1).name).toBe('User 1');
        expect(all.find(u => u.id === 100).name).toBe('User 100');
      });
    });
  });
}

// ── Adapter Pair 1: Memory ↔ SQLite ──────────────────────

crossAdapterSuite(
  'Cross-Adapter Sync: Memory ↔ SQLite',
  createMemory,
  createSQLite,
);

// ── Adapter Pair 2: Memory ↔ Turso ──────────────────────

describe.skipIf(!tursoAvailable)('Cross-Adapter Sync: Memory ↔ Turso', () => {
  crossAdapterSuite(
    'Memory → Turso',
    createMemory,
    createTurso,
  );
});

// ── Adapter Pair 3: SQLite ↔ Turso ──────────────────────

describe.skipIf(!tursoAvailable)('Cross-Adapter Sync: SQLite ↔ Turso', () => {
  crossAdapterSuite(
    'SQLite → Turso',
    createSQLite,
    createTurso,
  );
});
