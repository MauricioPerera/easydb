/**
 * Integration test helpers — connection factories with graceful skip logic.
 *
 * Each `try*()` function attempts to connect to an external service.
 * Returns the client on success, or null if the service is unavailable,
 * allowing tests to skip gracefully without Docker.
 */

/**
 * Try to connect to PostgreSQL.
 * Returns a pg.Pool or null.
 */
export async function tryPostgres() {
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432', 10),
      user: process.env.PG_USER || 'easydb',
      password: process.env.PG_PASSWORD || 'easydb_test',
      database: process.env.PG_DATABASE || 'easydb_test',
      max: 5,
      connectionTimeoutMillis: 3000,
    });
    // Test the connection
    const client = await pool.connect();
    client.release();
    return pool;
  } catch {
    return null;
  }
}

/**
 * Try to connect to Redis.
 * Returns an ioredis instance or null.
 */
export async function tryRedis() {
  try {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    return redis;
  } catch {
    return null;
  }
}

/**
 * Try to create a Turso/libSQL client (in-memory, no external service needed).
 * Returns a @libsql/client instance or null.
 */
export async function tryTurso() {
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: 'file::memory:' });
    await client.execute('SELECT 1');
    return client;
  } catch {
    return null;
  }
}

/**
 * Try to connect to MongoDB.
 * Returns { client, db } or null.
 */
export async function tryMongo() {
  try {
    const { MongoClient } = await import('mongodb');
    const url = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    const db = client.db(process.env.MONGO_DATABASE || 'easydb_test');
    return { client, db };
  } catch {
    return null;
  }
}

/**
 * Try to connect to MySQL.
 * Returns a mysql2/promise Pool or null.
 */
export async function tryMySQL() {
  try {
    const mysql = await import('mysql2/promise');
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'easydb',
      password: process.env.MYSQL_PASSWORD || 'easydb_test',
      database: process.env.MYSQL_DATABASE || 'easydb_test',
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 3000,
    });
    const conn = await pool.getConnection();
    conn.release();
    return pool;
  } catch {
    return null;
  }
}

/**
 * Standard schema matching conformance.test.js.
 */
export function standardSchema(b) {
  b.createStore('users', {
    key: 'id',
    indexes: ['role', { name: 'email', unique: true }],
  });
  b.createStore('tasks', { key: 'id', autoIncrement: true });
}
