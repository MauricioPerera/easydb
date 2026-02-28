/**
 * EasyDB — Adapter Usage Examples
 *
 * Shows how to use each storage adapter.
 * Each example is self-contained with the import you need.
 */

// ════════════════════════════════════════════════════════
// 1. localStorage (Browser — simple persistence)
// ════════════════════════════════════════════════════════

import EasyDB from '@rckflr/easydb';

// import { LocalStorageAdapter } from '@rckflr/easydb/adapters/localstorage';
//
// const db = await EasyDB.open('my-app', {
//   adapter: new LocalStorageAdapter(),
//   schema(s) {
//     s.createStore('settings', { key: 'key' });
//     s.createStore('bookmarks', { key: 'id', autoIncrement: true });
//   }
// });
//
// await db.settings.put({ key: 'theme', value: 'dark' });
// await db.settings.put({ key: 'lang', value: 'es' });
// const theme = await db.settings.get('theme');
// console.log(theme.value); // 'dark'

// ════════════════════════════════════════════════════════
// 2. SQLite (Node.js — local-first, ACID transactions)
// ════════════════════════════════════════════════════════

// import { SQLiteAdapter } from '@rckflr/easydb/adapters/sqlite';
//
// // File-based (persists to disk):
// const db = await EasyDB.open('app', {
//   adapter: new SQLiteAdapter('./my-data.db'),
//   schema(s) {
//     s.createStore('users', { key: 'id', indexes: ['email'] });
//     s.createStore('posts', { key: 'id', autoIncrement: true });
//   }
// });
//
// // In-memory (for testing):
// const testDb = await EasyDB.open('test', {
//   adapter: new SQLiteAdapter(':memory:'),
//   schema(s) { s.createStore('items', { key: 'id' }); }
// });
//
// await db.users.put({ id: 1, name: 'Alice', email: 'alice@example.com' });
// const posts = await db.posts.putMany([
//   { title: 'First Post', content: 'Hello world' },
//   { title: 'Second Post', content: 'More content' },
// ]);
// console.log(posts); // [1, 2] (auto-incremented keys)

// ════════════════════════════════════════════════════════
// 3. PostgreSQL (Server — via pg or @neondatabase/serverless)
// ════════════════════════════════════════════════════════

// import { PostgresAdapter } from '@rckflr/easydb/adapters/postgres';
// import { Pool } from 'pg';
//
// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// const db = await EasyDB.open('app', {
//   adapter: new PostgresAdapter(pool),
//   schema(s) {
//     s.createStore('users', { key: 'id', indexes: ['role'] });
//     s.createStore('orders', { key: 'id', autoIncrement: true });
//   }
// });
//
// // Works with Neon serverless too:
// // import { neon } from '@neondatabase/serverless';
// // const sql = neon(process.env.DATABASE_URL);
// // adapter: new PostgresAdapter(sql)

// ════════════════════════════════════════════════════════
// 4. Redis (Server — via ioredis or @upstash/redis)
// ════════════════════════════════════════════════════════

// import { RedisAdapter } from '@rckflr/easydb/adapters/redis';
// import Redis from 'ioredis';
//
// const redis = new Redis(process.env.REDIS_URL);
// const db = await EasyDB.open('app', {
//   adapter: new RedisAdapter(redis),
//   schema(s) {
//     s.createStore('sessions', { key: 'id' });
//     s.createStore('cache', { key: 'key' });
//   }
// });
//
// await db.sessions.put({ id: 'sess_abc', userId: 42, expires: Date.now() + 3600000 });
// const session = await db.sessions.get('sess_abc');
//
// // With Upstash (serverless Redis):
// // import { Redis } from '@upstash/redis';
// // const redis = new Redis({ url: process.env.UPSTASH_URL, token: process.env.UPSTASH_TOKEN });
// // adapter: new RedisAdapter(redis)

// ════════════════════════════════════════════════════════
// 5. Turso / libSQL (Edge — SQLite anywhere)
// ════════════════════════════════════════════════════════

// import { TursoAdapter } from '@rckflr/easydb/adapters/turso';
// import { createClient } from '@libsql/client';
//
// const client = createClient({
//   url: process.env.TURSO_URL,        // e.g. libsql://my-db-user.turso.io
//   authToken: process.env.TURSO_TOKEN,
// });
//
// const db = await EasyDB.open('app', {
//   adapter: new TursoAdapter(client),
//   schema(s) {
//     s.createStore('users', { key: 'id', indexes: ['email'] });
//   }
// });
//
// // Also works with local libSQL files:
// // const local = createClient({ url: 'file:./local.db' });

// ════════════════════════════════════════════════════════
// 6. Cloudflare D1 (Workers — SQLite at the edge)
// ════════════════════════════════════════════════════════

// import { D1Adapter } from '@rckflr/easydb/adapters/d1';
//
// export default {
//   async fetch(request, env) {
//     const db = await EasyDB.open('app', {
//       adapter: new D1Adapter(env.DB),
//       schema(s) {
//         s.createStore('users', { key: 'id', indexes: ['role'] });
//       }
//     });
//     const admins = await db.users.where('role', 'admin').toArray();
//     return Response.json(admins);
//   }
// };

// ════════════════════════════════════════════════════════
// 7. Cloudflare KV (Workers — key-value at the edge)
// ════════════════════════════════════════════════════════

// import { KVAdapter } from '@rckflr/easydb/adapters/kv';
//
// export default {
//   async fetch(request, env) {
//     const db = await EasyDB.open('app', {
//       adapter: new KVAdapter(env.MY_KV),
//       schema(s) {
//         s.createStore('config', { key: 'key' });
//       }
//     });
//     await db.config.put({ key: 'theme', value: 'dark' });
//   }
// };
