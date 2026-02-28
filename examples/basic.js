/**
 * EasyDB Usage Examples
 *
 * Run these in a browser console or include in your app.
 * Each example is self-contained.
 */

import { EasyDB } from '../src/easydb.js';

// ════════════════════════════════════════════════════════
// 1. Basic CRUD
// ════════════════════════════════════════════════════════

async function crudExample() {
  const db = await EasyDB.open('example-crud', {
    schema(db) {
      db.createStore('users', { key: 'id', indexes: ['email'] });
    }
  });

  // Create
  await db.users.put({ id: 1, name: 'Mauricio', email: 'mau@test.com' });
  await db.users.put({ id: 2, name: 'Ana', email: 'ana@test.com' });

  // Read
  const user = await db.users.get(1);
  console.log(user); // { id: 1, name: 'Mauricio', email: 'mau@test.com' }

  // Update
  await db.users.put({ ...user, name: 'Mauricio Updated' });

  // Delete
  await db.users.delete(2);

  // Batch
  const users = await db.users.getMany([1, 2]);
  console.log(users); // [{ id: 1, ... }, undefined]

  db.close();
  await EasyDB.destroy('example-crud');
}

// ════════════════════════════════════════════════════════
// 2. Queries with Async Iterables
// ════════════════════════════════════════════════════════

async function queryExample() {
  const db = await EasyDB.open('example-query', {
    schema(db) {
      db.createStore('products', {
        key: 'id',
        indexes: ['category', 'price']
      });
    }
  });

  // Seed data
  await db.products.putMany([
    { id: 1, name: 'Laptop', category: 'electronics', price: 999 },
    { id: 2, name: 'Phone', category: 'electronics', price: 699 },
    { id: 3, name: 'Desk', category: 'furniture', price: 299 },
    { id: 4, name: 'Chair', category: 'furniture', price: 199 },
    { id: 5, name: 'Monitor', category: 'electronics', price: 449 },
  ]);

  // Iterate all (pull cursor — only reads what you consume)
  for await (const product of db.products.all()) {
    console.log(product.name);
    if (product.price > 500) break; // cursor closes, no more I/O
  }

  // Filter by index
  const electronics = await db.products.where('category', 'electronics').toArray();
  console.log(electronics.length); // 3

  // Range query
  const affordable = await db.products.where('price').lt(300).toArray();
  console.log(affordable.map(p => p.name)); // ['Desk', 'Chair']

  // Range + compound filter
  const cheapElectronics = await db.products
    .where('price').lt(500)
    .filter(p => p.category === 'electronics')
    .toArray();
  console.log(cheapElectronics.map(p => p.name)); // ['Monitor']

  // First match
  const cheapest = await db.products.where('price').gte(0).first();
  console.log(cheapest.name); // 'Chair' (lowest price)

  // Count (native IDB — no cursor)
  const totalElectronics = await db.products.where('category', 'electronics').count();
  console.log(totalElectronics); // 3

  db.close();
  await EasyDB.destroy('example-query');
}

// ════════════════════════════════════════════════════════
// 3. Transactions
// ════════════════════════════════════════════════════════

async function transactionExample() {
  const db = await EasyDB.open('example-tx', {
    schema(db) {
      db.createStore('accounts', { key: 'id' });
      db.createStore('transfers', { key: 'id', autoIncrement: true });
    }
  });

  await db.accounts.put({ id: 'A', balance: 1000 });
  await db.accounts.put({ id: 'B', balance: 500 });

  // Successful transfer
  await db.transaction(['accounts', 'transfers'], async (tx) => {
    const from = await tx.accounts.get('A');
    const to = await tx.accounts.get('B');

    from.balance -= 200;
    to.balance += 200;

    await tx.accounts.put(from);
    await tx.accounts.put(to);
    await tx.transfers.put({
      from: 'A', to: 'B', amount: 200, date: new Date().toISOString()
    });
  });

  console.log((await db.accounts.get('A')).balance); // 800
  console.log((await db.accounts.get('B')).balance); // 700

  // Failed transfer — auto rollback
  try {
    await db.transaction(['accounts'], async (tx) => {
      const from = await tx.accounts.get('A');
      from.balance -= 5000;
      if (from.balance < 0) throw new Error('Insufficient funds');
      await tx.accounts.put(from);
    });
  } catch (err) {
    console.log(err.message); // 'Insufficient funds'
  }

  // Balance unchanged after rollback
  console.log((await db.accounts.get('A')).balance); // still 800

  db.close();
  await EasyDB.destroy('example-tx');
}

// ════════════════════════════════════════════════════════
// 4. Watch (Reactive Observation)
// ════════════════════════════════════════════════════════

async function watchExample() {
  const db = await EasyDB.open('example-watch', {
    schema(db) {
      db.createStore('messages', { key: 'id', autoIncrement: true });
    }
  });

  // Start watcher in background
  let eventCount = 0;
  const watchDone = (async () => {
    for await (const change of db.messages.watch()) {
      console.log(`[${change.type}]`, change.key, change.value);
      eventCount++;
      if (eventCount >= 3) break; // stop after 3 events
    }
  })();

  // Give watcher time to initialize
  await new Promise(r => setTimeout(r, 10));

  // These writes trigger watch events
  await db.messages.put({ id: 1, text: 'Hello' });   // [put] 1 { id: 1, text: 'Hello' }
  await db.messages.put({ id: 2, text: 'World' });   // [put] 2 { id: 2, text: 'World' }
  await db.messages.delete(1);                         // [delete] 1 undefined

  await watchDone;
  console.log('Watcher received', eventCount, 'events');

  db.close();
  await EasyDB.destroy('example-watch');
}

// ════════════════════════════════════════════════════════
// Run all examples
// ════════════════════════════════════════════════════════

async function main() {
  console.log('=== CRUD ===');
  await crudExample();

  console.log('\n=== QUERIES ===');
  await queryExample();

  console.log('\n=== TRANSACTIONS ===');
  await transactionExample();

  console.log('\n=== WATCH ===');
  await watchExample();

  console.log('\n✅ All examples completed');
}

main().catch(console.error);
