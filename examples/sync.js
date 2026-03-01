/**
 * EasyDB — SyncEngine Usage Examples
 *
 * Shows how to synchronize data between different storage backends.
 * Each example is self-contained.
 */

import EasyDB from '@rckflr/easydb';
import { SyncEngine } from '@rckflr/easydb/sync';

// ════════════════════════════════════════════════════════
// 1. Push sync: browser IndexedDB → server PostgreSQL
// ════════════════════════════════════════════════════════

// import { PostgresAdapter } from '@rckflr/easydb/adapters/postgres';
// import { Pool } from 'pg';
//
// const schema = s => {
//   s.createStore('users', { key: 'id', indexes: ['role'] });
//   s.createStore('orders', { key: 'orderId', indexes: ['userId'] });
// };
//
// const local = await EasyDB.open('app', { schema });
// const remote = await EasyDB.open('app', {
//   adapter: new PostgresAdapter(new Pool({ connectionString: process.env.DATABASE_URL })),
//   schema,
// });
//
// const sync = new SyncEngine(local, remote, {
//   stores: ['users', 'orders'],
//   direction: 'push',
//   onSync(e) { console.log(`Synced ${e.store}:${e.key} (${e.type})`); },
// });
//
// sync.start();
// // Every local write now replicates to PostgreSQL in real-time
// await local.users.put({ id: 1, name: 'Alice', role: 'admin' });

// ════════════════════════════════════════════════════════
// 2. Pull sync: poll remote D1 → local Memory
// ════════════════════════════════════════════════════════

// import { D1Adapter } from '@rckflr/easydb';
// import { MemoryAdapter } from '@rckflr/easydb';
//
// const cache = await EasyDB.open('cache', {
//   adapter: new MemoryAdapter(),
//   schema: s => s.createStore('config', { key: 'key' }),
// });
//
// const origin = await EasyDB.open('cache', {
//   adapter: new D1Adapter(env.DB),
//   schema: s => s.createStore('config', { key: 'key' }),
// });
//
// const sync = new SyncEngine(cache, origin, {
//   stores: ['config'],
//   direction: 'pull',
//   pullInterval: 10_000,  // poll every 10 seconds
// });
//
// sync.start();
// // Local cache stays in sync with remote D1

// ════════════════════════════════════════════════════════
// 3. Bidirectional sync with last-write-wins
// ════════════════════════════════════════════════════════

// const schema = s => {
//   s.createStore('notes', { key: 'id', indexes: ['updatedAt'] });
// };
//
// const device1 = await EasyDB.open('notes', { adapter: adapter1, schema });
// const device2 = await EasyDB.open('notes', { adapter: adapter2, schema });
//
// const sync = new SyncEngine(device1, device2, {
//   stores: ['notes'],
//   direction: 'bidirectional',
//   conflict: 'last-write-wins',
//   timestampField: 'updatedAt',
//   onSync(e) {
//     if (e.conflict) console.log(`Conflict resolved for ${e.store}:${e.key}`);
//   },
// });
//
// sync.start();
//
// // Both sides can write; newest timestamp wins on conflict
// await device1.notes.put({ id: 1, text: 'Hello', updatedAt: Date.now() });

// ════════════════════════════════════════════════════════
// 4. Manual conflict resolution (custom merge)
// ════════════════════════════════════════════════════════

// const sync = new SyncEngine(local, remote, {
//   stores: ['scores'],
//   direction: 'bidirectional',
//   conflict: 'manual',
//   onConflict(store, key, sourceVal, targetVal) {
//     // Merge: keep the higher score, merge tags
//     return {
//       ...sourceVal,
//       score: Math.max(sourceVal.score || 0, targetVal.score || 0),
//       tags: [...new Set([...(sourceVal.tags || []), ...(targetVal.tags || [])])],
//     };
//   },
// });

// ════════════════════════════════════════════════════════
// 5. One-time full sync (initial hydration)
// ════════════════════════════════════════════════════════

// const sync = new SyncEngine(local, remote, {
//   stores: ['users', 'orders', 'products'],
//   direction: 'bidirectional',
//   conflict: 'source-wins',
// });
//
// // Full reconciliation — no watchers, just a one-shot diff
// await sync.syncAll();
// console.log('Initial sync complete');
//
// // Then start real-time
// sync.start();

// ════════════════════════════════════════════════════════
// 6. Pause/resume (offline handling)
// ════════════════════════════════════════════════════════

// sync.start();
//
// // User goes offline
// window.addEventListener('offline', () => {
//   sync.pause();
//   console.log('Sync paused — events will queue');
// });
//
// // User comes back online
// window.addEventListener('online', async () => {
//   await sync.resume();
//   console.log('Sync resumed — queued events flushed');
// });

// ════════════════════════════════════════════════════════
// 7. Error handling and monitoring
// ════════════════════════════════════════════════════════

// const sync = new SyncEngine(local, remote, {
//   stores: ['users'],
//   direction: 'push',
//   onSync(event) {
//     console.log(`[sync] ${event.op} ${event.store}:${event.key} ${event.type}`);
//     if (event.conflict) console.log('  → conflict resolved');
//   },
//   onError(err, ctx) {
//     console.error(`[sync error] ${ctx.op} on ${ctx.store}:`, err.message);
//     // Could trigger a full re-sync or alert the user
//   },
// });
