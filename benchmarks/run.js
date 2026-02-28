/**
 * EasyDB Benchmarks — measures overhead vs raw IndexedDB
 *
 * Usage: node benchmarks/run.js
 *
 * Uses fake-indexeddb (same as tests), so numbers reflect
 * abstraction overhead, not real browser IDB performance.
 */
import 'fake-indexeddb/auto';
import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { LocalStorageAdapter } from '../src/adapters/localstorage.js';
import { SQLiteAdapter } from '../src/adapters/sqlite.js';

const N = 1000; // records per benchmark
const RUNS = 5; // runs per benchmark (take median)

// ── Helpers ──────────────────────────────────────────────

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function bench(label, fn) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  const ms = median(times);
  return { label, ms, opsPerSec: Math.round((N / ms) * 1000) };
}

function report(title, results) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
  console.log(
    'Operation'.padEnd(28) +
    'Time (ms)'.padStart(12) +
    'ops/s'.padStart(12) +
    'Overhead'.padStart(12)
  );
  console.log('─'.repeat(64));

  // Pair up raw vs easydb results
  for (let i = 0; i < results.length; i += 2) {
    const raw = results[i];
    const easy = results[i + 1];
    if (!easy) {
      console.log(
        raw.label.padEnd(28) +
        raw.ms.toFixed(2).padStart(12) +
        String(raw.opsPerSec).padStart(12) +
        '—'.padStart(12)
      );
      continue;
    }
    const overhead = raw.ms > 0 ? ((easy.ms - raw.ms) / raw.ms * 100) : 0;
    const sign = overhead >= 0 ? '+' : '';

    console.log(
      raw.label.padEnd(28) +
      raw.ms.toFixed(2).padStart(12) +
      String(raw.opsPerSec).padStart(12) +
      '—'.padStart(12)
    );
    console.log(
      easy.label.padEnd(28) +
      easy.ms.toFixed(2).padStart(12) +
      String(easy.opsPerSec).padStart(12) +
      (sign + overhead.toFixed(1) + '%').padStart(12)
    );
  }
}

function makeUser(i) {
  return {
    id: i,
    name: `User ${i}`,
    email: `user${i}@test.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    age: 20 + (i % 50)
  };
}

// ── Raw IndexedDB helpers ────────────────────────────────

function rawOpen(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore('users', { keyPath: 'id' });
      store.createIndex('age', 'age');
      store.createIndex('role', 'role');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function rawPut(db, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    tx.objectStore('users').put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function rawPutMany(db, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users');
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function rawGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readonly');
    const req = tx.objectStore('users').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function rawGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readonly');
    const req = tx.objectStore('users').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function rawCount(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readonly');
    const req = tx.objectStore('users').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function rawCursorAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readonly');
    const req = tx.objectStore('users').openCursor();
    const results = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { results.push(cursor.value); cursor.continue(); }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

function rawDestroy(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Benchmarks ───────────────────────────────────────────

async function benchmarkIDB() {
  const items = Array.from({ length: N }, (_, i) => makeUser(i + 1));
  const results = [];

  // ── putMany ──
  const rawPutManyR = await bench('Raw IDB putMany', async () => {
    const db = await rawOpen(`bench-raw-putmany-${Date.now()}`);
    await rawPutMany(db, items);
    db.close();
  });
  results.push(rawPutManyR);

  const easyPutManyR = await bench('EasyDB putMany', async () => {
    const db = await EasyDB.open(`bench-easy-putmany-${Date.now()}`, {
      schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
    });
    await db.users.putMany(items);
    db.close();
  });
  results.push(easyPutManyR);

  // ── Seed databases for read benchmarks ──
  const rawDb = await rawOpen(`bench-raw-read-${Date.now()}`);
  await rawPutMany(rawDb, items);

  const easyDb = await EasyDB.open(`bench-easy-read-${Date.now()}`, {
    schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
  });
  await easyDb.users.putMany(items);

  // ── get (single) ──
  results.push(await bench('Raw IDB get', async () => {
    for (let i = 1; i <= N; i++) await rawGet(rawDb, i);
  }));
  results.push(await bench('EasyDB get', async () => {
    for (let i = 1; i <= N; i++) await easyDb.users.get(i);
  }));

  // ── getAll ──
  results.push(await bench('Raw IDB getAll', async () => {
    await rawGetAll(rawDb);
  }));
  results.push(await bench('EasyDB toArray()', async () => {
    await easyDb.users.all().toArray();
  }));

  // ── count ──
  results.push(await bench('Raw IDB count', async () => {
    await rawCount(rawDb);
  }));
  results.push(await bench('EasyDB count()', async () => {
    await easyDb.users.count();
  }));

  // ── cursor iteration ──
  results.push(await bench('Raw IDB cursor', async () => {
    await rawCursorAll(rawDb);
  }));
  results.push(await bench('EasyDB for-await', async () => {
    const arr = [];
    for await (const u of easyDb.users.all()) arr.push(u);
  }));

  rawDb.close();
  easyDb.close();

  report(`IDB: EasyDB vs Raw IndexedDB (${N} records, median of ${RUNS})`, results);
}

async function benchmarkMemory() {
  const items = Array.from({ length: N }, (_, i) => makeUser(i + 1));
  const results = [];

  // ── putMany ──
  results.push(await bench('Memory putMany', async () => {
    const db = await EasyDB.open(`bench-mem-pm-${Date.now()}`, {
      adapter: new MemoryAdapter(),
      schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
    });
    await db.users.putMany(items);
    db.close();
  }));

  // Seed
  const db = await EasyDB.open(`bench-mem-read-${Date.now()}`, {
    adapter: new MemoryAdapter(),
    schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
  });
  await db.users.putMany(items);

  results.push(await bench('Memory get ×' + N, async () => {
    for (let i = 1; i <= N; i++) await db.users.get(i);
  }));

  results.push(await bench('Memory toArray()', async () => {
    await db.users.all().toArray();
  }));

  results.push(await bench('Memory count()', async () => {
    await db.users.count();
  }));

  results.push(await bench('Memory page(5, 20)', async () => {
    await db.users.all().page(5, 20).toArray();
  }));

  db.close();

  console.log(`\n── Memory Adapter (${N} records, median of ${RUNS}) ${'─'.repeat(20)}`);
  console.log('Operation'.padEnd(28) + 'Time (ms)'.padStart(12) + 'ops/s'.padStart(12));
  console.log('─'.repeat(52));
  for (const r of results) {
    console.log(r.label.padEnd(28) + r.ms.toFixed(2).padStart(12) + String(r.opsPerSec).padStart(12));
  }
}

async function benchmarkLocalStorage() {
  // Mock localStorage for Node.js
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };

  const items = Array.from({ length: N }, (_, i) => makeUser(i + 1));
  const results = [];

  results.push(await bench('LS putMany', async () => {
    store.clear();
    const db = await EasyDB.open(`bench-ls-pm-${Date.now()}`, {
      adapter: new LocalStorageAdapter(),
      schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
    });
    await db.users.putMany(items);
    db.close();
  }));

  // Seed
  store.clear();
  const db = await EasyDB.open(`bench-ls-read`, {
    adapter: new LocalStorageAdapter(),
    schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
  });
  await db.users.putMany(items);

  results.push(await bench('LS get ×' + N, async () => {
    for (let i = 1; i <= N; i++) await db.users.get(i);
  }));

  results.push(await bench('LS toArray()', async () => {
    await db.users.all().toArray();
  }));

  results.push(await bench('LS count()', async () => {
    await db.users.count();
  }));

  results.push(await bench('LS page(5, 20)', async () => {
    await db.users.all().page(5, 20).toArray();
  }));

  db.close();

  console.log(`\n── LocalStorage Adapter (${N} records, median of ${RUNS}) ${'─'.repeat(12)}`);
  console.log('Operation'.padEnd(28) + 'Time (ms)'.padStart(12) + 'ops/s'.padStart(12));
  console.log('─'.repeat(52));
  for (const r of results) {
    console.log(r.label.padEnd(28) + r.ms.toFixed(2).padStart(12) + String(r.opsPerSec).padStart(12));
  }
}

async function benchmarkSQLite() {
  const items = Array.from({ length: N }, (_, i) => makeUser(i + 1));
  const results = [];

  results.push(await bench('SQLite putMany', async () => {
    const db = await EasyDB.open(`bench-sqlite-pm-${Date.now()}`, {
      adapter: new SQLiteAdapter(':memory:'),
      schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
    });
    await db.users.putMany(items);
    db.close();
  }));

  // Seed
  const db = await EasyDB.open(`bench-sqlite-read`, {
    adapter: new SQLiteAdapter(':memory:'),
    schema: s => s.createStore('users', { key: 'id', indexes: ['age', 'role'] })
  });
  await db.users.putMany(items);

  results.push(await bench('SQLite get ×' + N, async () => {
    for (let i = 1; i <= N; i++) await db.users.get(i);
  }));

  results.push(await bench('SQLite toArray()', async () => {
    await db.users.all().toArray();
  }));

  results.push(await bench('SQLite count()', async () => {
    await db.users.count();
  }));

  results.push(await bench('SQLite page(5, 20)', async () => {
    await db.users.all().page(5, 20).toArray();
  }));

  db.close();

  console.log(`\n── SQLite Adapter (${N} records, median of ${RUNS}) ${'─'.repeat(18)}`);
  console.log('Operation'.padEnd(28) + 'Time (ms)'.padStart(12) + 'ops/s'.padStart(12));
  console.log('─'.repeat(52));
  for (const r of results) {
    console.log(r.label.padEnd(28) + r.ms.toFixed(2).padStart(12) + String(r.opsPerSec).padStart(12));
  }
}

// ── Run ──

console.log(`\nEasyDB Benchmarks — ${N} records, ${RUNS} runs each (median)\n`);

await benchmarkIDB();
await benchmarkMemory();
await benchmarkLocalStorage();
await benchmarkSQLite();

console.log('\nNote: Uses fake-indexeddb in Node. Real browser performance will differ.');
console.log('These benchmarks measure abstraction overhead, not absolute speed.\n');
