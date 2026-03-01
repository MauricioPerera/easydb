/**
 * Demo: MongoDB ↔ PostgreSQL Sync via EasyDB
 *
 * Shows how to connect to a MongoDB instance (e.g. Kernex.io)
 * and synchronize data with a PostgreSQL database.
 *
 * Usage:
 *   # Set your connection strings:
 *   export MONGO_URL="mongodb+srv://user:pass@cluster.kernex.io/mydb"
 *   export DATABASE_URL="postgresql://user:pass@host:5432/mydb"
 *
 *   node examples/mongo-to-postgres-sync.js
 */

import { EasyDB } from '../src/easydb.js';
import { MongoAdapter } from '../src/adapters/mongo.js';
import { PostgresAdapter } from '../src/adapters/postgres.js';
import { SyncEngine } from '../src/sync.js';

// ── Configuration ────────────────────────────────────────

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'easydb_test';
const PG_URL = process.env.DATABASE_URL || 'postgresql://easydb:easydb_test@localhost:5432/easydb_test';

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
  // 1. Connect to MongoDB
  console.log('Connecting to MongoDB...');
  const { MongoClient } = await import('mongodb');
  const mongoClient = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  });
  await mongoClient.connect();
  const mongoDB = mongoClient.db(MONGO_DB);
  console.log(`  ✔ MongoDB connected (${MONGO_URL})`);

  // 2. Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: PG_URL, max: 5 });
  await pool.query('SELECT 1'); // test connection
  console.log(`  ✔ PostgreSQL connected (${PG_URL.replace(/:[^:@]+@/, ':***@')})`);

  // 3. Open both databases with the SAME schema
  const mongoDb = await EasyDB.open('demo', {
    adapter: new MongoAdapter(mongoDB),
    schema,
  });

  const pgDb = await EasyDB.open('demo', {
    adapter: new PostgresAdapter(pool),
    schema,
  });

  console.log('\nBoth databases ready with stores:', mongoDb.stores);

  // 4. Write data to MongoDB (simulating Kernex.io data)
  console.log('\n── Writing data to MongoDB ──');
  await mongoDb.users.put({ id: 1, name: 'Alice', role: 'admin', email: 'alice@kernex.io' });
  await mongoDb.users.put({ id: 2, name: 'Bob', role: 'member', email: 'bob@kernex.io' });
  await mongoDb.users.put({ id: 3, name: 'Charlie', role: 'admin', email: 'charlie@kernex.io' });
  await mongoDb.tasks.put({ title: 'Deploy v2', priority: 'high' });
  await mongoDb.tasks.put({ title: 'Write docs', priority: 'medium' });

  const mongoUsers = await mongoDb.users.getAll();
  const mongoTasks = await mongoDb.tasks.getAll();
  console.log(`  MongoDB: ${mongoUsers.length} users, ${mongoTasks.length} tasks`);

  // 5. Sync MongoDB → PostgreSQL
  console.log('\n── Syncing MongoDB → PostgreSQL ──');
  const sync = new SyncEngine(mongoDb, pgDb, {
    stores: ['users', 'tasks'],
    direction: 'push',
    conflict: 'source-wins',
    onSync(event) {
      console.log(`  synced: ${event.store}.${event.type}(${event.key})`);
    },
    onError(err, ctx) {
      console.error(`  error: ${ctx.store} — ${err.message}`);
    },
  });

  // One-time full sync (copies all data)
  await sync.syncAll();

  // 6. Verify data in PostgreSQL
  console.log('\n── Verifying PostgreSQL ──');
  const pgUsers = await pgDb.users.getAll();
  const pgTasks = await pgDb.tasks.getAll();
  console.log(`  PostgreSQL: ${pgUsers.length} users, ${pgTasks.length} tasks`);

  for (const user of pgUsers) {
    console.log(`    user: ${user.name} (${user.role}) — ${user.email}`);
  }
  for (const task of pgTasks) {
    console.log(`    task #${task.id}: ${task.title} [${task.priority}]`);
  }

  // 7. Query PostgreSQL with the same API
  console.log('\n── Querying PostgreSQL (same API as MongoDB) ──');
  const admins = await pgDb.users.where('role', 'admin').toArray();
  console.log(`  Admins: ${admins.map(u => u.name).join(', ')}`);

  const firstTask = await pgDb.tasks.all().first();
  console.log(`  First task: ${firstTask.title}`);

  const userCount = await pgDb.users.count();
  console.log(`  Total users: ${userCount}`);

  // 8. Real-time sync (optional — start watching for changes)
  console.log('\n── Starting real-time sync (MongoDB → PostgreSQL) ──');
  sync.start();

  // Simulate a new write to MongoDB
  await mongoDb.users.put({ id: 4, name: 'Diana', role: 'member', email: 'diana@kernex.io' });
  console.log('  Wrote new user to MongoDB...');

  // Give sync a moment to propagate
  await new Promise(r => setTimeout(r, 500));

  const diana = await pgDb.users.get(4);
  console.log(`  PostgreSQL has Diana: ${diana ? 'YES' : 'NO'} ${diana ? `(${diana.name}, ${diana.email})` : ''}`);

  // 9. Cleanup
  sync.stop();
  console.log('\n── Cleanup ──');

  await EasyDB.destroy('demo', { adapter: new MongoAdapter(mongoDB) });
  await EasyDB.destroy('demo', { adapter: new PostgresAdapter(pool) });

  mongoDb.close();
  pgDb.close();
  await mongoClient.close();
  await pool.end();

  console.log('  Done. Both databases cleaned up.\n');
}

main().catch(err => {
  console.error('\nError:', err.message);
  console.error('\nMake sure both databases are running:');
  console.error('  docker compose up postgres mongo -d --wait');
  console.error('  node examples/mongo-to-postgres-sync.js\n');
  process.exit(1);
});
