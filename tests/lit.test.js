import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { EasyDBQueryController, EasyDBRecordController } from '../src/lit.js';

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
});
