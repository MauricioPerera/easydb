# EasyDB

> Multi-backend storage with `async/await`, async iterables, and modern JavaScript — IndexedDB, Memory, D1/SQLite.

Inspired by Cloudflare's ["We deserve a better streams API"](https://blog.cloudflare.com/a-better-web-streams-api/) philosophy — applying pull semantics, zero ceremony, and native fast paths to client-side and edge storage.

## Why?

IndexedDB was designed in 2011 with DOM events. Reading a single record requires ~18 lines of callback-based code. EasyDB reduces that to one:

```javascript
const user = await db.users.get(42);
```

And the same API works across **browsers** (IndexedDB), **tests/SSR** (Memory), and **Cloudflare Workers** (D1/SQLite) — swap the adapter, keep your code.

## Features

- **Multi-backend** — IndexedDB, Memory, and Cloudflare D1/SQLite via pluggable adapters
- **~400 LOC core, zero dependencies** — thin ergonomic wrapper, not a framework
- **Proxy-based store access** — `db.users`, `db.orders` without registration
- **Async iterables** — `for await (const user of db.users.all())` with true pull-based cursors
- **Range queries** — `.gt()`, `.lt()`, `.between()` using native key ranges
- **Fluent query builder** — `.where('role', 'admin').filter(u => u.age > 30).limit(10).toArray()`
- **Transactions** — multi-store with auto-rollback on throw
- **Watch** — `for await (const change of db.users.watch())` reactive observation
- **Cross-tab sync** — watch events broadcast across browser tabs via BroadcastChannel
- **Migrations** — versioned schema migrations with `migrations: { 1: fn, 2: fn }`
- **Fast paths** — `toArray()` uses `getAll()` when possible; `count()` uses native count
- **Batch operations** — `putMany()`, `getMany()`
- **TypeScript** — full type declarations included
- **~4.9KB gzip** (browser) / **~6.4KB gzip** (Workers)

## Installation

```bash
npm install @aspect/easydb
```

## Quick Start

### Browser (IndexedDB — default)

```javascript
import { EasyDB } from '@aspect/easydb';

const db = await EasyDB.open('myApp', {
  schema(s) {
    s.createStore('users', {
      key: 'id',
      indexes: ['role', 'age', { name: 'email', unique: true }]
    });
    s.createStore('orders', { key: 'orderId', indexes: ['userId'] });
  }
});

// CRUD
await db.users.put({ id: 1, name: 'Alice', role: 'admin', age: 32 });
const user = await db.users.get(1);
await db.users.delete(1);

// Query
const admins = await db.users
  .where('role', 'admin')
  .filter(u => u.age > 30)
  .limit(5)
  .toArray();

// Range queries
const adults = await db.users.where('age').between(18, 65).toArray();

// Async iteration with pull cursor
for await (const user of db.users.all()) {
  console.log(user.name);
  if (user.role === 'admin') break; // cursor closes, no wasted reads
}
```

### Testing / SSR (Memory)

```javascript
import { EasyDB, MemoryAdapter } from '@aspect/easydb';

const db = await EasyDB.open('test', {
  adapter: new MemoryAdapter(),
  schema(s) {
    s.createStore('users', { key: 'id' });
  }
});
// Same API — no browser, no polyfill needed
```

### Cloudflare Workers (D1/SQLite)

```javascript
import { EasyDB, D1Adapter } from '@aspect/easydb';

export default {
  async fetch(request, env) {
    const db = await EasyDB.open('app', {
      adapter: new D1Adapter(env.DB),
      schema(s) {
        s.createStore('users', { key: 'id', indexes: ['role'] });
      }
    });
    const user = await db.users.get(1);
    return Response.json(user);
  }
};
```

## Migrations

Use the `migrations` API for versioned schema changes. Only new migrations run on upgrade.

```javascript
const db = await EasyDB.open('myApp', {
  migrations: {
    1: (s) => {
      s.createStore('users', { key: 'id', indexes: ['role'] });
    },
    2: (s) => {
      s.createStore('orders', { key: 'orderId', indexes: ['userId'] });
    },
    3: (s) => {
      s.createStore('logs', { key: 'id', autoIncrement: true });
    }
  }
});

// Version is auto-inferred from highest key (3 in this case)
// Re-opening at a higher version only runs migrations > current version
```

You can also set an explicit version:

```javascript
const db = await EasyDB.open('myApp', {
  version: 10,
  migrations: {
    1: (s) => { s.createStore('users', { key: 'id' }); },
  }
});
```

## Watch

Observe mutations reactively with async iterables:

```javascript
// Watch all mutations on a store
for await (const event of db.users.watch()) {
  console.log(event.type, event.key, event.value);
  // type: 'put' | 'delete' | 'clear'
}

// Watch a specific key
for await (const event of db.users.watch({ key: 42 })) {
  console.log('User 42 changed:', event);
}
```

### Cross-tab sync

In browsers with `BroadcastChannel` support, watch events automatically propagate across tabs. No configuration needed — if another tab calls `db.users.put(...)`, your watchers fire.

```javascript
// Tab 1
for await (const event of db.users.watch()) {
  console.log('Change from any tab:', event);
}

// Tab 2
await db.users.put({ id: 1, name: 'Updated in tab 2' });
// Tab 1's watcher fires with the put event
```

## Transactions

Multi-store transactions with automatic rollback on error:

```javascript
await db.transaction(['users', 'orders'], async (tx) => {
  const user = await tx.users.get(1);
  user.orderCount += 1;
  await tx.users.put(user);
  await tx.orders.put({ orderId: 'abc', userId: 1 });
  // throw → everything rolls back
});
```

## API Reference

### `EasyDB.open(name, options?)`

Opens or creates a database. Returns `Promise<EasyDB>`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | `number` | `1` | Schema version |
| `schema` | `(builder, oldVersion) => void` | — | Schema definition callback |
| `migrations` | `Record<number, fn>` | — | Versioned migrations (alternative to `schema`) |
| `adapter` | `Adapter` | `IDBAdapter` | Storage backend |

### `EasyDB.destroy(name, options?)`

Deletes a database. Pass `{ adapter }` when using a non-default backend.

### Instance properties

| Property | Description |
|----------|-------------|
| `db.stores` | Array of store names |
| `db.version` | Current database version |
| `db.store(name)` | Explicit store access (for names that collide with methods) |
| `db.close()` | Close connection and clean up watchers |

### Store access (`db.storeName`)

Accessed via Proxy — any property returns a store accessor.

| Method | Description |
|--------|-------------|
| `.get(key)` | Get single record |
| `.getAll()` | Get all records |
| `.getMany(keys)` | Batch get |
| `.put(value)` | Insert or update (returns key) |
| `.putMany(items)` | Batch insert/update (returns count) |
| `.delete(key)` | Delete by key |
| `.clear()` | Delete all records |
| `.count()` | Count records |
| `.all()` | Returns `QueryBuilder` for all records |
| `.where(index, value?)` | Returns `QueryBuilder` with index filter |
| `.watch(opts?)` | Returns async iterable of mutation events |

### `QueryBuilder`

Chainable, immutable query builder. Implements `Symbol.asyncIterator`.

| Method | Description |
|--------|-------------|
| `.gt(value)` | Greater than |
| `.gte(value)` | Greater than or equal |
| `.lt(value)` | Less than |
| `.lte(value)` | Less than or equal |
| `.between(lo, hi)` | Inclusive range |
| `.filter(fn)` | JS-side predicate (composable — multiple are ANDed) |
| `.limit(n)` | Max results |
| `.desc()` | Reverse order |
| `.asc()` | Forward order (default) |
| `.toArray()` | Collect all results |
| `.first()` | Get first result |
| `.count()` | Count matching results |

**Fast paths:**
- `toArray()` without `.filter()` uses `getAll(range, limit)` — no cursor overhead
- `count()` without `.filter()` uses native count

### Schema builder

```javascript
schema(builder, oldVersion) {
  builder.createStore('users', {
    key: 'id',              // keyPath (primary key)
    autoIncrement: false,   // auto-generate keys
    indexes: [
      'role',                          // simple index
      { name: 'email', unique: true }  // unique index
    ]
  });
}
```

## Adapters

EasyDB uses a pluggable adapter architecture. All adapters implement the same interface, so your application code stays identical.

| Adapter | Import | Use case | Persistence |
|---------|--------|----------|-------------|
| `IDBAdapter` | `@aspect/easydb` | Browser apps | Persistent (IndexedDB) |
| `MemoryAdapter` | `@aspect/easydb` | Testing, SSR, prototyping | In-memory only |
| `D1Adapter` | `@aspect/easydb` | Cloudflare Workers | Persistent (D1/SQLite) |

### Writing a custom adapter

Implement the `Adapter` interface:

```javascript
class MyAdapter {
  async open(name, options) {
    // Return an object implementing AdapterConnection:
    // name, version, storeNames, hasStore(), getKeyPath(), close(),
    // get(), getAll(), count(), getMany(),
    // put(), delete(), clear(), putMany(),
    // cursor() (async generator), transaction()
  }
  async destroy(name) { /* delete the database */ }
}
```

See `src/adapters/memory.js` for a complete reference implementation.

## Architecture

```
Your code (async/await)
        |
   EasyDB API (Proxy + AsyncIterable)
        |
   ┌────┼────────────────────┐
   |    |                    |
Tx Mgr   QueryBuilder    Watch Engine
(auto      (pull cursor     (cross-tab
rollback)   + range          BroadcastChannel)
             + filter)
   |    |                    |
   └────┼────────────────────┘
        |
   Adapter Interface
        |
   ┌────┼──────────┐
   |    |          |
  IDB  Memory     D1
(browser) (test)  (Workers)
```

## Bundle Size

| Component | LOC |
|-----------|-----|
| Core | 407 |
| IDB Adapter | 244 |
| Memory Adapter | 290 |
| D1 Adapter | 421 |

| Bundle | Gzip |
|--------|------|
| Browser (Core + IDB) | ~4.9 KB |
| Workers (Core + D1) | ~6.4 KB |

## Known Limitations

### IndexedDB adapter
- **Transactions auto-commit** when there are no pending IDB requests in the event loop. Avoid `await fetch()` inside a transaction.
- **No compound indexes** — IndexedDB doesn't support `WHERE a = 1 AND b = 2` natively. Use `.filter()` for JS-side compound predicates.

### D1 adapter
- **Transactions are emulated** — D1 doesn't support multi-statement transactions natively. EasyDB snapshots tables before executing and restores on error. This is safe for single-worker concurrency but not for multi-worker concurrent writes.

### General
- **No JOINs, GROUP BY, or SQL** — If you need complex analytical queries, use SQLite WASM or raw D1 SQL instead.

## Comparison with Alternatives

| Feature | EasyDB | Dexie.js | idb | SQLite WASM |
|---------|--------|----------|-----|-------------|
| Size | ~400 LOC core | ~15k LOC | ~2KB | ~800KB WASM |
| Multi-backend | IndexedDB, Memory, D1 | IndexedDB only | IndexedDB only | SQLite only |
| Async iterables | Pull cursor | Callback-based | No | No |
| Range queries | Native | Native | Manual | SQL |
| Watch/reactive | Cross-tab | Advanced LiveQuery | No | No |
| Transactions | Auto-rollback | Robust | Yes | Yes |
| Migrations | Versioned map | Version-based | Manual | SQL migrations |
| TypeScript | Included | Included | Included | Varies |
| Dependencies | 0 | 0 | 0 | WASM binary |

**Use EasyDB when:** You want simple CRUD + queries + reactivity with a unified API across browser, server, and edge — in a minimal package.

**Use Dexie.js when:** You need production-grade IndexedDB features, advanced live queries, and battle-tested edge case handling at scale.

**Use SQLite WASM when:** You need JOINs, GROUP BY, subqueries, or complex analytical queries in the browser.

## Development

```bash
git clone https://github.com/MauricioPerera/easydb.git
cd easydb
npm install
npm test            # Run all 224 tests
npm run metrics     # Show LOC and gzip sizes
```

## Context

This project emerged from a discussion about Cloudflare's blog post ["We deserve a better streams API for JavaScript"](https://blog.cloudflare.com/a-better-web-streams-api/) by James M Snell, which argues that Web Streams carry design decisions from 2014 that don't align with modern JavaScript.

We asked: **what other JS APIs deserve the same treatment?** IndexedDB was the obvious candidate — an API from 2011 that predates `async/await`, async iterables, and Proxy, all of which are now standard JavaScript.

EasyDB started as a proof of concept and evolved into a multi-backend storage library with adapters for IndexedDB, in-memory, and Cloudflare D1 — demonstrating that modern JavaScript primitives can provide a clean, unified storage API across environments.

## License

MIT

## Author

[Mauricio Perera](https://github.com/MauricioPerera) — [Automators.work](https://automators.work)
