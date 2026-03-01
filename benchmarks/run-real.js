/**
 * EasyDB Real Adapter Benchmarks
 *
 * Measures actual performance against real database services:
 * SQLite (always), Turso/libSQL (local), PostgreSQL (Docker), Redis (Docker).
 *
 * Usage: node benchmarks/run-real.js
 */
import { EasyDB } from '../src/easydb.js';
import { SQLiteAdapter } from '../src/adapters/sqlite.js';

const N = 1000;
const RUNS = 5;

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
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
  console.log('Operation'.padEnd(28) + 'Time (ms)'.padStart(12) + 'ops/s'.padStart(12));
  console.log('─'.repeat(52));
  for (const r of results) {
    console.log(r.label.padEnd(28) + r.ms.toFixed(2).padStart(12) + String(r.opsPerSec).padStart(12));
  }
}

function makeUser(i) {
  return {
    id: i,
    name: `User ${i}`,
    email: `user${i}@test.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    age: 20 + (i % 50),
  };
}

function schema(s) {
  s.createStore('users', { key: 'id', indexes: ['age', 'role'] });
}

async function benchAdapter(adapterName, createAdapter, cleanup) {
  const items = Array.from({ length: N }, (_, i) => makeUser(i + 1));
  const results = [];

  // putMany
  results.push(await bench(`${adapterName} putMany`, async () => {
    const db = await EasyDB.open(`bench-${adapterName.toLowerCase()}-pm-${Date.now()}`, {
      adapter: createAdapter(),
      schema,
    });
    await db.users.putMany(items);
    db.close();
  }));

  // Seed database for read benchmarks
  const db = await EasyDB.open(`bench-${adapterName.toLowerCase()}-read-${Date.now()}`, {
    adapter: createAdapter(),
    schema,
  });
  await db.users.putMany(items);

  // get ×N
  results.push(await bench(`${adapterName} get ×${N}`, async () => {
    for (let i = 1; i <= N; i++) await db.users.get(i);
  }));

  // toArray
  results.push(await bench(`${adapterName} toArray()`, async () => {
    await db.users.all().toArray();
  }));

  // count
  results.push(await bench(`${adapterName} count()`, async () => {
    await db.users.count();
  }));

  // cursor
  results.push(await bench(`${adapterName} for-await`, async () => {
    const arr = [];
    for await (const u of db.users.all()) arr.push(u);
  }));

  // page
  results.push(await bench(`${adapterName} page(5, 20)`, async () => {
    await db.users.all().page(5, 20).toArray();
  }));

  db.close();

  report(`${adapterName} (${N} records, median of ${RUNS})`, results);

  if (cleanup) await cleanup();
}

// ── Run ──────────────────────────────────────────────────

console.log(`\nEasyDB Real Adapter Benchmarks — ${N} records, ${RUNS} runs each (median)\n`);

// 1. SQLite (always available)
try {
  await benchAdapter('SQLite', () => new SQLiteAdapter(':memory:'));
} catch (err) {
  console.log('SQLite: skipped —', err.message);
}

// 2. Turso/libSQL (local, no Docker needed)
try {
  const { createClient } = await import('@libsql/client');
  const { TursoAdapter } = await import('../src/adapters/turso.js');

  await benchAdapter(
    'Turso',
    () => {
      const client = createClient({ url: 'file::memory:' });
      return new TursoAdapter(client);
    }
  );
} catch (err) {
  console.log('Turso: skipped —', err.message);
}

// 3. PostgreSQL (Docker)
try {
  const pg = await import('pg');
  const { PostgresAdapter } = await import('../src/adapters/postgres.js');

  const pool = new pg.default.Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'easydb',
    password: process.env.PG_PASSWORD || 'easydb_test',
    database: process.env.PG_DATABASE || 'easydb_test',
    max: 5,
    connectionTimeoutMillis: 3000,
  });

  // Test connection
  const testClient = await pool.connect();
  testClient.release();

  await benchAdapter(
    'PostgreSQL',
    () => new PostgresAdapter(pool),
    async () => {
      // Clean up tables
      try {
        await pool.query('DROP TABLE IF EXISTS "users" CASCADE');
        await pool.query('DROP TABLE IF EXISTS "_easydb_meta" CASCADE');
      } catch {}
      await pool.end();
    }
  );
} catch (err) {
  console.log('PostgreSQL: skipped —', err.message);
}

// 4. Redis (Docker)
try {
  const { default: Redis } = await import('ioredis');
  const { RedisAdapter } = await import('../src/adapters/redis.js');

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  await redis.connect();
  await redis.ping();

  const prefix = `bench_${Date.now()}:`;

  await benchAdapter(
    'Redis',
    () => new RedisAdapter(redis, { prefix }),
    async () => {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    }
  );
} catch (err) {
  console.log('Redis: skipped —', err.message);
}

console.log('\nDone. Adapters that required Docker were skipped if services were unavailable.\n');
