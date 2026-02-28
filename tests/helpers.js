/**
 * Test helpers — shared fixtures and utilities
 */
import { EasyDB } from '../src/easydb.js';

let dbCounter = 0;

/**
 * Create a fresh test database with a unique name.
 * Includes 'users' and 'orders' stores by default.
 */
export async function createTestDB(customSchema) {
  const name = `test-db-${Date.now()}-${dbCounter++}`;
  const db = await EasyDB.open(name, {
    schema: customSchema || ((db) => {
      db.createStore('users', {
        key: 'id',
        indexes: ['role', 'country', 'age', { name: 'email', unique: true }]
      });
      db.createStore('orders', {
        key: 'orderId',
        indexes: ['userId', 'total']
      });
    })
  });
  return { db, name };
}

/**
 * Destroy a test database and close the connection.
 */
export async function destroyTestDB(db, name) {
  db.close();
  await EasyDB.destroy(name);
}

/**
 * Seed the users store with sample data.
 */
export async function seedUsers(db, count = 10) {
  const users = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@test.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    country: ['UY', 'MX', 'AR', 'CO', 'CL'][i % 5],
    age: 20 + i * 3
  }));
  await db.users.putMany(users);
  return users;
}

/**
 * Collect all items from an async iterable into an array.
 */
export async function collect(asyncIterable) {
  const results = [];
  for await (const item of asyncIterable) {
    results.push(item);
  }
  return results;
}

/**
 * Helper to wait a short time (for watch setup etc.)
 */
export function wait(ms = 10) {
  return new Promise(r => setTimeout(r, ms));
}
