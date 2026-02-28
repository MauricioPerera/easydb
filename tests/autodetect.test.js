import { describe, it, expect, vi, afterEach } from 'vitest';
import { EasyDB } from '../src/easydb.js';

describe('Adapter auto-detection', () => {
  afterEach(async () => {
    // Restore indexedDB if we removed it
    if (!globalThis.indexedDB) {
      const { default: fakeIDB } = await import('fake-indexeddb');
      globalThis.indexedDB = fakeIDB;
    }
  });

  it('uses IDBAdapter when indexedDB is available', async () => {
    // fake-indexeddb provides globalThis.indexedDB in the test env
    const db = await EasyDB.open('auto-idb-' + Math.random(), {
      schema(b) { b.createStore('items', { key: 'id' }); },
    });
    expect(db.stores).toContain('items');
    await db.items.put({ id: 1, value: 'test' });
    expect(await db.items.get(1)).toEqual({ id: 1, value: 'test' });
    db.close();
  });

  it('falls back to MemoryAdapter when indexedDB is absent', async () => {
    const saved = globalThis.indexedDB;
    delete globalThis.indexedDB;

    try {
      const db = await EasyDB.open('auto-mem-' + Math.random(), {
        schema(b) { b.createStore('items', { key: 'id' }); },
      });
      expect(db.stores).toContain('items');
      await db.items.put({ id: 1, value: 'test' });
      expect(await db.items.get(1)).toEqual({ id: 1, value: 'test' });
      db.close();
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it('explicit adapter overrides auto-detection', async () => {
    const { MemoryAdapter } = await import('../src/easydb.js');
    const db = await EasyDB.open('explicit-' + Math.random(), {
      adapter: new MemoryAdapter(),
      schema(b) { b.createStore('items', { key: 'id' }); },
    });
    await db.items.put({ id: 1, value: 'explicit' });
    expect(await db.items.get(1)).toEqual({ id: 1, value: 'explicit' });
    db.close();
  });
});
