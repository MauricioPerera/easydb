import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { EasyDBQueryController, EasyDBRecordController, EasyDBSyncStatusController } from '../src/lit.js';
import { SyncEngine } from '../src/sync.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// Mock Lit ReactiveControllerHost
function createMockHost() {
  const controllers = [];
  const host = {
    addController(ctrl) {
      controllers.push(ctrl);
    },
    requestUpdate: vi.fn(),
    _controllers: controllers,
    // Simulate lifecycle
    connect() {
      for (const ctrl of controllers) {
        if (ctrl.hostConnected) ctrl.hostConnected();
      }
    },
    disconnect() {
      for (const ctrl of controllers) {
        if (ctrl.hostDisconnected) ctrl.hostDisconnected();
      }
    },
  };
  return host;
}

describe('Lit integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open('lit-test-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('users', { key: 'id' }); },
    });
    await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
    await db.users.put({ id: 2, name: 'Bob', role: 'member' });
    await db.users.put({ id: 3, name: 'Charlie', role: 'admin' });
  });

  describe('EasyDBQueryController', () => {
    it('registers itself with the host', () => {
      const host = createMockHost();
      const ctrl = new EasyDBQueryController(host, db.users);
      expect(host._controllers).toContain(ctrl);
    });

    it('fetches data on hostConnected', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBQueryController(host, db.users);
      expect(ctrl.loading).toBe(true);
      expect(ctrl.data).toEqual([]);

      host.connect();
      await tick();

      expect(ctrl.loading).toBe(false);
      expect(ctrl.data).toHaveLength(3);
      expect(ctrl.error).toBeNull();
      expect(host.requestUpdate).toHaveBeenCalled();
    });

    it('works with QueryBuilder', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBQueryController(host, db.users.where('role', 'admin'));
      host.connect();
      await tick();

      expect(ctrl.data).toHaveLength(2);
      expect(ctrl.data.every(u => u.role === 'admin')).toBe(true);
    });

    it('auto-refreshes on mutations via watch', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBQueryController(host, db.users);
      host.connect();
      await tick();
      expect(ctrl.data).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      await tick(50);
      expect(ctrl.data).toHaveLength(4);
    });

    it('stops watching on hostDisconnected', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBQueryController(host, db.users);
      host.connect();
      await tick();

      const callsBefore = host.requestUpdate.mock.calls.length;
      host.disconnect();

      await db.users.put({ id: 5, name: 'Eve', role: 'admin' });
      await tick(50);
      // No new requestUpdate calls after disconnect
      expect(host.requestUpdate.mock.calls.length).toBe(callsBefore);
    });

    it('refresh() re-fetches data', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBQueryController(host, db.users, { watch: false });
      host.connect();
      await tick();
      expect(ctrl.data).toHaveLength(3);

      await db.users.put({ id: 4, name: 'Diana', role: 'member' });
      // Not yet updated (watch disabled)
      expect(ctrl.data).toHaveLength(3);

      ctrl.refresh();
      await tick();
      expect(ctrl.data).toHaveLength(4);
    });
  });

  describe('EasyDBRecordController', () => {
    it('fetches a single record', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBRecordController(host, db.users, 1);
      host.connect();
      await tick();

      expect(ctrl.loading).toBe(false);
      expect(ctrl.data).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    });

    it('returns undefined for missing keys', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBRecordController(host, db.users, 999);
      host.connect();
      await tick();

      expect(ctrl.loading).toBe(false);
      expect(ctrl.data).toBeUndefined();
    });

    it('auto-refreshes when the record changes', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBRecordController(host, db.users, 1);
      host.connect();
      await tick();
      expect(ctrl.data.name).toBe('Alice');

      await db.users.put({ id: 1, name: 'Alice Updated', role: 'admin' });
      await tick(50);
      expect(ctrl.data.name).toBe('Alice Updated');
    });

    it('refresh() re-fetches the record', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBRecordController(host, db.users, 2, { watch: false });
      host.connect();
      await tick();
      expect(ctrl.data.name).toBe('Bob');

      await db.users.put({ id: 2, name: 'Bob Updated', role: 'member' });
      expect(ctrl.data.name).toBe('Bob');

      ctrl.refresh();
      await tick();
      expect(ctrl.data.name).toBe('Bob Updated');
    });

    it('cleans up watcher on disconnect', async () => {
      const host = createMockHost();
      const ctrl = new EasyDBRecordController(host, db.users, 1);
      host.connect();
      await tick();

      const callsBefore = host.requestUpdate.mock.calls.length;
      host.disconnect();

      await db.users.put({ id: 1, name: 'Alice Modified', role: 'admin' });
      await tick(50);
      expect(host.requestUpdate.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('EasyDBSyncStatusController', () => {
    let db2, sync;

    beforeEach(async () => {
      db2 = await EasyDB.open('lit-sync-target-' + Math.random(), {
        adapter: new MemoryAdapter(),
        schema(b) { b.createStore('users', { key: 'id' }); },
      });
      sync = new SyncEngine(db, db2, {
        stores: ['users'],
        direction: 'push',
      });
    });

    it('registers itself with the host', () => {
      const host = createMockHost();
      const ctrl = new EasyDBSyncStatusController(host, sync);
      expect(host._controllers).toContain(ctrl);
    });

    it('exposes initial status', () => {
      const host = createMockHost();
      const ctrl = new EasyDBSyncStatusController(host, sync);
      expect(ctrl.running).toBe(false);
      expect(ctrl.paused).toBe(false);
      expect(ctrl.lastEvent).toBeNull();
      expect(ctrl.error).toBeNull();
    });

    it('tracks sync events after hostConnected', async () => {
      sync.start();
      const host = createMockHost();
      const ctrl = new EasyDBSyncStatusController(host, sync);
      host.connect();

      await db.users.put({ id: 10, name: 'New', role: 'test' });
      await tick(50);

      expect(ctrl.lastEvent).not.toBeNull();
      expect(ctrl.lastEvent.store).toBe('users');
      expect(ctrl.lastEvent.type).toBe('put');
      expect(host.requestUpdate).toHaveBeenCalled();

      sync.stop();
    });

    it('tracks errors', () => {
      const host = createMockHost();
      const ctrl = new EasyDBSyncStatusController(host, sync);
      host.connect();

      sync._onError(new Error('lit sync err'), { op: 'push', store: 'users' });

      expect(ctrl.error).not.toBeNull();
      expect(ctrl.error.err.message).toBe('lit sync err');
    });

    it('cleans up on hostDisconnected', () => {
      const host = createMockHost();
      const ctrl = new EasyDBSyncStatusController(host, sync);
      host.connect();
      host.disconnect();

      // Original callbacks should be restored
      expect(sync._onSync).toBeNull();
      expect(sync._onError).toBeNull();
    });
  });
});
