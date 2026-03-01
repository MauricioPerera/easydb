/**
 * Demo: Cross-Adapter Sync — simulates MongoDB ↔ PostgreSQL pattern
 *
 * Uses Memory (simulating MongoDB/Kernex.io) and SQLite (simulating PostgreSQL)
 * to demonstrate the exact same sync flow without external services.
 *
 * The API is IDENTICAL — just swap the adapter to connect to real databases.
 */

import { EasyDB, MemoryAdapter } from '../src/easydb.js';
import { SQLiteAdapter } from '../src/adapters/sqlite.js';
import { SyncEngine } from '../src/sync.js';

// ── Schema (shared between both databases) ───────────────

function schema(s) {
  s.createStore('users', {
    key: 'id',
    indexes: ['role', { name: 'email', unique: true }],
  });
  s.createStore('tasks', {
    key: 'id',
    autoIncrement: true,
  });
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  // Source: simulates MongoDB / Kernex.io
  // In production: new MongoAdapter(mongoClient.db('mydb'))
  const sourceDb = await EasyDB.open('kernex', {
    adapter: new MemoryAdapter(),
    schema,
  });

  // Target: simulates PostgreSQL
  // In production: new PostgresAdapter(pgPool)
  const targetDb = await EasyDB.open('postgres', {
    adapter: new SQLiteAdapter(':memory:'),
    schema,
  });

  console.log('Source stores:', sourceDb.stores);
  console.log('Target stores:', targetDb.stores);

  // ── 1. Write data to source (Kernex.io / MongoDB) ──
  console.log('\n── Writing data to source (MongoDB) ──');
  await sourceDb.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'alice@kernex.io' });
  await sourceDb.users.put({ id: 2, name: 'Bob', role: 'member', email: 'bob@kernex.io' });
  await sourceDb.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'charlie@kernex.io' });
  await sourceDb.tasks.put({ title: 'Deploy v2', priority: 'high' });
  await sourceDb.tasks.put({ title: 'Write docs', priority: 'medium' });

  console.log(`  Source: ${await sourceDb.users.count()} users, ${await sourceDb.tasks.count()} tasks`);

  // ── 2. Sync source → target ──
  console.log('\n── Syncing source → target ──');
  const sync = new SyncEngine(sourceDb, targetDb, {
    stores: ['users', 'tasks'],
    direction: 'push',
    conflict: 'source-wins',
    onSync(event) {
      console.log(`  synced: ${event.store}.${event.type}(${event.key})`);
    },
  });

  await sync.syncAll();

  // ── 3. Verify target has the data ──
  console.log('\n── Verifying target (PostgreSQL) ──');
  const pgUsers = await targetDb.users.getAll();
  const pgTasks = await targetDb.tasks.getAll();
  console.log(`  Target: ${pgUsers.length} users, ${pgTasks.length} tasks`);

  for (const user of pgUsers) {
    console.log(`    user: ${user.name} (${user.role}) — ${user.email}`);
  }
  for (const task of pgTasks) {
    console.log(`    task #${task.id}: ${task.title} [${task.priority}]`);
  }

  // ── 4. Same query API on both databases ──
  console.log('\n── Same queries work on both databases ──');

  const sourceAdmins = await sourceDb.users.where('role', 'admin').toArray();
  const targetAdmins = await targetDb.users.where('role', 'admin').toArray();
  console.log(`  Source admins: ${sourceAdmins.map(u => u.name).join(', ')}`);
  console.log(`  Target admins: ${targetAdmins.map(u => u.name).join(', ')}`);

  const sourceCount = await sourceDb.users.count();
  const targetCount = await targetDb.users.count();
  console.log(`  Source count: ${sourceCount}`);
  console.log(`  Target count: ${targetCount}`);
  console.log(`  Data matches: ${sourceCount === targetCount ? 'YES' : 'NO'}`);

  // ── 5. Real-time sync demo ──
  console.log('\n── Real-time sync (new writes propagate) ──');
  sync.start();

  await sourceDb.users.put({ id: 4, name: 'Diana', role: 'member', email: 'diana@kernex.io' });
  console.log('  Wrote Diana to source...');

  await new Promise(r => setTimeout(r, 200));

  const diana = await targetDb.users.get(4);
  console.log(`  Target has Diana: ${diana ? 'YES' : 'NO'} ${diana ? `(${diana.name})` : ''}`);

  // ── 6. Bidirectional sync ──
  sync.stop();
  console.log('\n── Bidirectional sync (changes flow both ways) ──');

  const biSync = new SyncEngine(sourceDb, targetDb, {
    stores: ['users'],
    direction: 'bidirectional',
    conflict: 'last-write-wins',
    timestampField: 'updatedAt',
    onSync(event) {
      console.log(`  bi-sync: ${event.store}.${event.type}(${event.key})`);
    },
  });

  biSync.start();

  // Write to target (PostgreSQL) — should sync back to source (MongoDB)
  await targetDb.users.put({ id: 5, name: 'Eve', role: 'admin', email: 'eve@pg.com', updatedAt: Date.now() });
  console.log('  Wrote Eve to target (PostgreSQL)...');

  await new Promise(r => setTimeout(r, 200));

  const eveInSource = await sourceDb.users.get(5);
  console.log(`  Source has Eve: ${eveInSource ? 'YES' : 'NO'} ${eveInSource ? `(${eveInSource.name})` : ''}`);

  biSync.stop();

  // ── Summary ──
  console.log('\n── Final state ──');
  console.log(`  Source: ${await sourceDb.users.count()} users`);
  console.log(`  Target: ${await targetDb.users.count()} users`);

  console.log('\n  To use with real MongoDB + PostgreSQL, just swap the adapters:');
  console.log('    new MemoryAdapter()     → new MongoAdapter(mongoClient.db("mydb"))');
  console.log('    new SQLiteAdapter(":memory:") → new PostgresAdapter(pgPool)');
  console.log('  The rest of the code stays IDENTICAL.\n');

  sourceDb.close();
  targetDb.close();
}

main().catch(console.error);
