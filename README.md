# EasyDB

> Multi-backend storage with `async/await`, async iterables, and modern JavaScript — IndexedDB, SQLite, PostgreSQL, Redis, Turso, D1, KV, localStorage.

Inspired by Cloudflare's ["We deserve a better streams API"](https://blog.cloudflare.com/a-better-web-streams-api/) philosophy — applying pull semantics, zero ceremony, and native fast paths to client-side and edge storage.

## Why?

IndexedDB was designed in 2011 with DOM events. Reading a single record requires ~18 lines of callback-based code. EasyDB reduces that to one:

```javascript
const user = await db.users.get(42);
```

And the same API works across **browsers** (IndexedDB), **Node.js** (SQLite, PostgreSQL, Redis), **edge** (D1, KV, Turso), and **tests** (Memory) — swap the adapter, keep your code.

## Features

- **9 storage adapters** — IndexedDB, Memory, SQLite, PostgreSQL, Redis, Turso, D1, KV, localStorage
- **7 framework integrations** — React, Vue, Svelte, Angular, Solid.js, Preact, Lit
- **~400 LOC core, zero dependencies** — thin ergonomic wrapper, not a framework
- **Proxy-based store access** — `db.users`, `db.orders` without registration
- **Async iterables** — `for await (const user of db.users.all())` with true pull-based cursors
- **Range queries** — `.gt()`, `.lt()`, `.between()` using native key ranges
- **Fluent query builder** — `.where('role', 'admin').filter(u => u.age > 30).limit(10).toArray()`
- **Transactions** — multi-store with auto-rollback on throw
- **Watch** — `for await (const change of db.users.watch())` reactive observation
- **Cross-tab sync** — watch events broadcast across browser tabs via BroadcastChannel
- **Cross-adapter sync** — push, pull, or bidirectional replication between any two adapters
- **Migrations** — versioned schema migrations with `migrations: { 1: fn, 2: fn }`
- **Fast paths** — `toArray()` uses `getAll()` when possible; `count()` uses native count
- **Batch operations** — `putMany()`, `getMany()`
- **TypeScript** — full type declarations with generic schema support
- **~4.4KB gzip** (browser bundle)

## Installation

```bash
npm install @rckflr/easydb
```

## Quick Start

### Browser (IndexedDB — default)

```javascript
import { EasyDB } from '@rckflr/easydb';

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

### Node.js (SQLite)

```javascript
import { EasyDB } from '@rckflr/easydb';
import { SQLiteAdapter } from '@rckflr/easydb/adapters/sqlite';

const db = await EasyDB.open('app', {
  adapter: new SQLiteAdapter('./my-data.db'),  // or ':memory:' for testing
  schema(s) {
    s.createStore('users', { key: 'id', indexes: ['email'] });
    s.createStore('posts', { key: 'id', autoIncrement: true });
  }
});
// Same API — full ACID transactions via better-sqlite3
```

### Node.js (PostgreSQL)

```javascript
import { PostgresAdapter } from '@rckflr/easydb/adapters/postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await EasyDB.open('app', {
  adapter: new PostgresAdapter(pool),
  schema(s) {
    s.createStore('users', { key: 'id', indexes: ['role'] });
  }
});
```

### Node.js (Redis)

```javascript
import { RedisAdapter } from '@rckflr/easydb/adapters/redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const db = await EasyDB.open('app', {
  adapter: new RedisAdapter(redis),
  schema(s) {
    s.createStore('sessions', { key: 'id' });
  }
});
```

### Edge (Turso / libSQL)

```javascript
import { TursoAdapter } from '@rckflr/easydb/adapters/turso';
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
const db = await EasyDB.open('app', {
  adapter: new TursoAdapter(client),
  schema(s) {
    s.createStore('users', { key: 'id', indexes: ['email'] });
  }
});
```

### Cloudflare Workers (D1)

```javascript
import { EasyDB, D1Adapter } from '@rckflr/easydb';

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

### Testing / SSR (Memory)

```javascript
import { EasyDB, MemoryAdapter } from '@rckflr/easydb';

const db = await EasyDB.open('test', {
  adapter: new MemoryAdapter(),
  schema(s) {
    s.createStore('users', { key: 'id' });
  }
});
// Same API — no browser, no polyfill needed
```

## Framework Integrations

EasyDB provides reactive bindings for 7 UI frameworks. All integrations auto-refresh when data changes via `watch()`.

### React

```javascript
import { useQuery, useRecord } from '@rckflr/easydb/react';

function UserList({ db }) {
  const { data, loading, error } = useQuery(db.users);
  if (loading) return <p>Loading...</p>;
  return data.map(u => <p key={u.id}>{u.name}</p>);
}

function UserProfile({ db, userId }) {
  const { data: user } = useRecord(db.users, userId);
  return <h1>{user?.name}</h1>;
}
```

### Vue 3

```javascript
import { useQuery, useRecord } from '@rckflr/easydb/vue';

// In <script setup>:
const { data, loading, error } = useQuery(db.users);
const admins = useQuery(db.users.where('role', 'admin'));

// Reactive key (re-fetches when ref changes):
const userId = ref(1);
const { data: user } = useRecord(db.users, userId);
```

### Svelte

```javascript
import { queryStore, recordStore } from '@rckflr/easydb/svelte';

const users = queryStore(db.users);
// {#if $users.loading} ... {:else} {#each $users.data as user} ... {/each} {/if}
```

### Angular 16+

```typescript
import { createQuery, createRecord } from '@rckflr/easydb/angular';

@Component({ template: `@for (user of users.data(); track user.id) { ... }` })
class UserList {
  users = createQuery(db.users);          // Signal-based
  admins = createQuery(() => db.users.where('role', 'admin'));  // Reactive
}
```

### Solid.js

```javascript
import { createQuery, createRecord } from '@rckflr/easydb/solid';

function UserList() {
  const users = createQuery(db.users);
  return <For each={users.data()}>{u => <p>{u.name}</p>}</For>;
}
```

### Preact

```javascript
import { useQuery, useRecord } from '@rckflr/easydb/preact';
// Same API as React — drop-in replacement
```

### Lit

```javascript
import { EasyDBQueryController, EasyDBRecordController } from '@rckflr/easydb/lit';

class UserList extends LitElement {
  _users = new EasyDBQueryController(this, db.users);
  render() {
    const { data, loading } = this._users;
    return loading ? html`<p>Loading...</p>` : html`<ul>${data.map(u => html`<li>${u.name}</li>`)}</ul>`;
  }
}
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

In browsers with `BroadcastChannel` support, watch events automatically propagate across tabs:

```javascript
// Tab 1
for await (const event of db.users.watch()) {
  console.log('Change from any tab:', event);
}

// Tab 2
await db.users.put({ id: 1, name: 'Updated in tab 2' });
// Tab 1's watcher fires with the put event
```

## Sync

Synchronize data between any two EasyDB instances (e.g. browser ↔ server, IndexedDB ↔ PostgreSQL):

```javascript
import { SyncEngine } from '@rckflr/easydb/sync';

const local  = await EasyDB.open('app', { adapter: idbAdapter, schema });
const remote = await EasyDB.open('app', { adapter: pgAdapter, schema });

const sync = new SyncEngine(local, remote, {
  stores: ['users', 'orders'],
  direction: 'bidirectional',   // 'push' | 'pull' | 'bidirectional'
  conflict: 'last-write-wins',  // 'source-wins' | 'target-wins' | 'last-write-wins' | 'manual'
  timestampField: 'updatedAt',
  onSync(event) { console.log(event.store, event.type, event.key); },
});

// Real-time sync (watch-based for push, polling for pull)
sync.start();

// Pause/resume
sync.pause();                // events queue up
await sync.resume();         // flush queued events

// One-time full sync
await sync.syncAll();        // reconcile all stores
await sync.syncStore('users'); // single store

sync.stop();                 // stop and clean up
```

### Custom conflict resolution

```javascript
const sync = new SyncEngine(local, remote, {
  stores: ['users'],
  conflict: 'manual',
  onConflict(store, key, sourceVal, targetVal) {
    // Merge strategy: keep source name, keep higher score
    return {
      ...sourceVal,
      score: Math.max(sourceVal.score, targetVal.score),
    };
  },
});
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
| `.skip(n)` | Skip first N results |
| `.page(num, size)` | Pagination (1-indexed) |
| `.desc()` | Reverse order |
| `.asc()` | Forward order (default) |
| `.toArray()` | Collect all results |
| `.first()` | Get first result |
| `.count()` | Count matching results |

## Adapters

EasyDB uses a pluggable adapter architecture. All adapters implement the same interface, so your application code stays identical.

| Adapter | Import | Runtime | Persistence |
|---------|--------|---------|-------------|
| `IDBAdapter` | `@rckflr/easydb` | Browser | IndexedDB |
| `MemoryAdapter` | `@rckflr/easydb` | Anywhere | In-memory |
| `SQLiteAdapter` | `@rckflr/easydb/adapters/sqlite` | Node.js | File / in-memory |
| `PostgresAdapter` | `@rckflr/easydb/adapters/postgres` | Node.js | PostgreSQL |
| `RedisAdapter` | `@rckflr/easydb/adapters/redis` | Node.js | Redis |
| `TursoAdapter` | `@rckflr/easydb/adapters/turso` | Node.js / Edge | Turso / libSQL |
| `D1Adapter` | `@rckflr/easydb` | Cloudflare Workers | D1 (SQLite) |
| `KVAdapter` | `@rckflr/easydb` | Cloudflare Workers | KV |
| `LocalStorageAdapter` | `@rckflr/easydb/adapters/localstorage` | Browser | localStorage |

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
   ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
  IDB  Memory  SQLite  PG   Redis Turso  D1    KV  localStorage
```

## Bundle Size

| CDN Bundle | Raw | Gzip |
|------------|-----|------|
| `easydb.mjs.js` (ESM) | 13.9 KB | **4.4 KB** |
| `easydb.iife.js` | 14.4 KB | 4.6 KB |
| `easydb.umd.js` | 14.7 KB | 4.8 KB |

Framework integrations: ~0.6–0.7 KB gzip each.

Build CDN bundles: `npm run build`

## TypeScript

EasyDB ships with full type declarations. Use generic schemas for type-safe store access:

```typescript
interface MySchema {
  users: { id: number; name: string; role: string };
  orders: { orderId: string; total: number };
}

const db = await EasyDB.open<MySchema>('app', { ... });
const user = await db.users.get(1);        // MySchema['users'] | undefined
const admins = await db.users.where('role', 'admin').toArray();  // MySchema['users'][]
```

## Known Limitations

### IndexedDB adapter
- **Transactions auto-commit** when there are no pending IDB requests in the event loop. Avoid `await fetch()` inside a transaction.
- **No compound indexes** — use `.filter()` for JS-side compound predicates.

### SQL adapters (D1, SQLite, PostgreSQL, Turso)
- **Transactions are emulated** with SAVEPOINT/BEGIN/snapshot depending on adapter.
- `.filter()` runs JS-side after the SQL query.

### Redis adapter
- All queries fetch records and filter in JS (no native range queries).
- Transactions are best-effort with rollback on error.

### General
- **No JOINs, GROUP BY, or SQL** — use raw drivers for complex analytical queries.

## Comparison with Alternatives

| Feature | EasyDB | Dexie.js | idb | SQLite WASM |
|---------|--------|----------|-----|-------------|
| Size | ~400 LOC core | ~15k LOC | ~2KB | ~800KB WASM |
| Multi-backend | 9 adapters | IndexedDB only | IndexedDB only | SQLite only |
| Framework bindings | 7 frameworks | React | No | No |
| Async iterables | Pull cursor | Callback-based | No | No |
| Range queries | Native | Native | Manual | SQL |
| Watch/reactive | Cross-tab | Advanced LiveQuery | No | No |
| Transactions | Auto-rollback | Robust | Yes | Yes |
| Migrations | Versioned map | Version-based | Manual | SQL migrations |
| TypeScript | Generic schemas | Included | Included | Varies |
| Dependencies | 0 | 0 | 0 | WASM binary |

## Documentation

- [Browser Compatibility](docs/BROWSER_COMPATIBILITY.md) — supported browsers, runtimes, and CDN usage
- [Migration Guide](docs/MIGRATION.md) — migrating from raw IndexedDB or Dexie.js
- [Adapter Comparison](docs/ADAPTERS.md) — choosing the right adapter for your use case
- [Contributing](docs/CONTRIBUTING.md) — how to contribute to EasyDB

## Development

```bash
git clone https://github.com/MauricioPerera/easydb.git
cd easydb
npm install
npm test            # Run all 696 tests
npm run build       # Generate CDN bundles (dist/)
npm run bench       # Run benchmarks
npm run metrics     # Show LOC and gzip sizes
```

## Context

This project emerged from a discussion about Cloudflare's blog post ["We deserve a better streams API for JavaScript"](https://blog.cloudflare.com/a-better-web-streams-api/) by James M Snell, which argues that Web Streams carry design decisions from 2014 that don't align with modern JavaScript.

We asked: **what other JS APIs deserve the same treatment?** IndexedDB was the obvious candidate — an API from 2011 that predates `async/await`, async iterables, and Proxy, all of which are now standard JavaScript.

EasyDB started as a proof of concept and evolved into a multi-backend storage library with 9 adapters and 7 framework integrations — demonstrating that modern JavaScript primitives can provide a clean, unified storage API across environments.

## License

MIT

## Author

[Mauricio Perera](https://github.com/MauricioPerera) — [Automators.work](https://automators.work)
