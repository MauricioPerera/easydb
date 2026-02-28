# EasyDB

> IndexedDB reimagined with `async/await`, async iterables, and modern JavaScript primitives.

Inspired by Cloudflare's ["We deserve a better streams API"](https://blog.cloudflare.com/a-better-web-streams-api/) philosophy — applying the same principles (pull semantics, zero ceremony, native fast paths) to browser-side storage.

## Why?

IndexedDB was designed in 2011 with DOM events. Reading a single record requires ~18 lines of callback-based code. EasyDB reduces that to one:

```javascript
const user = await db.users.get(42);
```

### Before (IndexedDB)

```javascript
const request = indexedDB.open('myDB', 1);
request.onupgradeneeded = (e) => {
  const db = e.target.result;
  db.createObjectStore('users', { keyPath: 'id' });
};
request.onsuccess = (e) => {
  const db = e.target.result;
  const tx = db.transaction('users', 'readonly');
  const store = tx.objectStore('users');
  const req = store.get(42);
  req.onsuccess = () => console.log(req.result);
  req.onerror = () => console.error(req.error);
};
```

### After (EasyDB)

```javascript
const db = await EasyDB.open('myDB', {
  schema(db) {
    db.createStore('users', { key: 'id' });
  }
});

const user = await db.users.get(42);
```

## Features

- **~250 lines, zero dependencies** — thin ergonomic wrapper over IndexedDB
- **Proxy-based store access** — `db.users`, `db.orders` without registration
- **Async iterables** — `for await (const user of db.users.all())` with true pull-based cursors
- **Range queries** — `.gt()`, `.lt()`, `.between()` using native `IDBKeyRange`
- **Compound filters** — `.filter(fn)` for JS-side predicates
- **Fluent query builder** — `.where('role', 'admin').filter(u => u.age > 30).limit(10).toArray()`
- **Transactions** — `await db.transaction(['users', 'orders'], async (tx) => { ... })` with auto-rollback
- **Watch** — `for await (const change of db.users.watch())` reactive observation
- **Fast paths** — `toArray()` uses `getAll()` when possible; `count()` uses native IDB count
- **Batch operations** — `putMany()`, `getMany()`

## Installation

```bash
# npm
npm install @aspect/easydb

# or just copy src/easydb.js — it's one file, zero deps
```

## Quick Start

```javascript
import { EasyDB } from '@aspect/easydb';

// Open database with schema
const db = await EasyDB.open('myApp', {
  schema(db) {
    db.createStore('users', {
      key: 'id',
      indexes: ['role', 'country', 'age']
    });
    db.createStore('orders', {
      key: 'orderId',
      indexes: ['userId']
    });
  }
});

// CRUD
await db.users.put({ id: 1, name: 'Mauricio', role: 'admin', age: 35 });
const user = await db.users.get(1);
await db.users.delete(1);

// Iterate with async iterables (true pull cursor)
for await (const user of db.users.all()) {
  console.log(user.name);
  if (user.role === 'admin') break; // cursor closes, no more reads
}

// Query builder
const admins = await db.users
  .where('role', 'admin')
  .filter(u => u.age > 30)
  .limit(5)
  .toArray();

// Range queries (native IDBKeyRange)
const adults = await db.users.where('age').between(18, 65).toArray();
const seniors = await db.users.where('age').gt(60).toArray();

// Transactions with auto-rollback
await db.transaction(['users', 'orders'], async (tx) => {
  const user = await tx.users.get(1);
  user.orderCount += 1;
  await tx.users.put(user);
  await tx.orders.put({ orderId: 'abc', userId: 1 });
  // throw → auto rollback
});

// Watch changes reactively
for await (const change of db.users.watch()) {
  console.log(change.type, change.key, change.value);
  // 'put' | 'delete' | 'clear'
}

// Batch operations
await db.users.putMany([user1, user2, user3]);
const batch = await db.users.getMany([1, 2, 3]);
```

## API Reference

### `EasyDB.open(name, options)`

Opens or creates a database. Returns a `Promise<EasyDB>`.

```javascript
const db = await EasyDB.open('myDB', {
  version: 1, // optional, default 1
  schema(db, oldVersion) {
    db.createStore('users', {
      key: 'id',              // keyPath
      autoIncrement: false,   // optional
      indexes: [              // optional
        'email',                       // simple index
        { name: 'email', unique: true } // unique index
      ]
    });
  }
});
```

### `EasyDB.destroy(name)`

Deletes a database.

### Store Access (`db.storeName`)

Accessed via Proxy — no pre-registration needed.

| Method | Description |
|--------|-------------|
| `.get(key)` | Get single record |
| `.getAll()` | Get all records |
| `.getMany(keys[])` | Batch get |
| `.put(value)` | Insert or update |
| `.putMany(items[])` | Batch insert |
| `.delete(key)` | Delete by key |
| `.clear()` | Delete all records |
| `.count()` | Count records (native IDB) |
| `.all()` | Returns `QueryBuilder` for all records |
| `.where(index, value?)` | Returns `QueryBuilder` with index filter |
| `.watch(opts?)` | Returns async iterable of mutations |

### `QueryBuilder`

Chainable, immutable query builder. Implements `Symbol.asyncIterator`.

| Method | Description |
|--------|-------------|
| `.gt(value)` | Greater than (IDBKeyRange) |
| `.gte(value)` | Greater than or equal |
| `.lt(value)` | Less than |
| `.lte(value)` | Less than or equal |
| `.between(lo, hi)` | Inclusive range |
| `.filter(fn)` | JS-side predicate |
| `.limit(n)` | Max results |
| `.desc()` | Reverse order |
| `.asc()` | Forward order (default) |
| `.toArray()` | Collect all results |
| `.first()` | Get first result |
| `.count()` | Count matching results |

**Fast paths:**
- `toArray()` without `.filter()` or `.limit()` uses `getAll(keyRange)` — no cursor overhead
- `count()` without `.filter()` uses native `IDBObjectStore.count(keyRange)`

## Design Principles

Directly inspired by [James M Snell's "new-streams" proposal](https://github.com/jasnell/new-streams):

1. **Async iterables as the base primitive** — queries, watch, bulk ops all use `for await...of`
2. **Pull semantics** — cursors only advance when the consumer asks for data
3. **Implicit transactions for simple ops, explicit when needed** — no ceremony for `get`/`put`
4. **Natural backpressure** — `break` in `for await` closes the cursor
5. **Zero ceremony** — no readers, no locks, no event listeners
6. **Native fast paths** — use IDB engine when possible, JS fallback when not

## Architecture

```
Your code (async/await)
        │
   EasyDB API (Proxy + AsyncIterable)
        │
   ┌────┼────────────────────┐
   │    │                    │
Tx Manager   QueryBuilder v2    Watch Engine
(auto lifecycle) (pull cursor     (EventTarget
                  + range          internal)
                  + filter)
   │    │                    │
   └────┼────────────────────┘
        │
   IndexedDB (native fast paths)
```

## Known Limitations

These are IndexedDB limitations, not EasyDB bugs:

- **Transactions auto-commit** when there are no pending IDB requests in the event loop. If you `await fetch()` inside a transaction, it will commit prematurely.
- **No compound queries** — IndexedDB doesn't support `WHERE a = 1 AND b = 2` natively. Use `.filter()` for JS-side compound predicates (less efficient than native).
- **Watch is per-instance** — mutations are only observed within the same EasyDB instance. Cross-tab observation would require BroadcastChannel (not implemented in POC).
- **No JOINs, GROUP BY, or SQL** — If you need complex queries, use SQLite WASM instead.

## Comparison with Alternatives

| Feature | EasyDB | Dexie.js | idb | SQLite WASM |
|---------|--------|----------|-----|-------------|
| Size | ~250 LOC | ~15k LOC | ~2KB | ~800KB WASM |
| Async iterables | ✅ Pull cursor | ❌ Callback-based | ❌ | ❌ |
| Range queries | ✅ Native | ✅ Native | Manual | ✅ SQL |
| Compound filter | ✅ `.filter()` | ✅ `.and()` | Manual | ✅ SQL |
| Watch/LiveQuery | ✅ Basic | ✅ Advanced | ❌ | ❌ |
| Transactions | ✅ Auto-rollback | ✅ Robust | ✅ | ✅ |
| SQL queries | ❌ | ❌ | ❌ | ✅ |
| TypeScript | ⚡ Ready | ✅ | ✅ | Varies |
| Dependencies | 0 | 0 | 0 | WASM binary |

**EasyDB is best when:** You need simple CRUD + index queries + reactivity in a minimal package.

**Use Dexie.js when:** You need production-grade features, advanced live queries, and battle-tested edge case handling.

**Use SQLite WASM when:** You need JOINs, GROUP BY, subqueries, or complex analytical queries.

## Development

This is a proof of concept — a conversation starter, not a production library.

```bash
# Clone
git clone https://github.com/MauricioPerera/easydb.git

# Open the demo
open demo/index.html
```

## Context

This project emerged from a discussion about Cloudflare's blog post ["We deserve a better streams API for JavaScript"](https://blog.cloudflare.com/a-better-web-streams-api/) by James M Snell, which argues that Web Streams carry design decisions from 2014 that don't align with modern JavaScript.

We asked: **what other JS APIs deserve the same treatment?** IndexedDB was the obvious candidate — an API from 2011 that predates `async/await`, async iterables, and Proxy, all of which are now standard JavaScript.

The result is EasyDB: a proof of concept showing that ~250 lines of modern JavaScript can eliminate ~85% of IndexedDB's boilerplate while adding pull-based cursors, range queries, reactive observation, and native IDB fast paths.

## License

MIT

## Author

[Mauricio Perera](https://github.com/MauricioPerera) — [Automators.work](https://automators.work)
