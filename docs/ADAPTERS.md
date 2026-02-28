# Adapter Comparison Guide

EasyDB supports multiple storage backends via its adapter architecture. All adapters expose the same API, so your application code stays identical — only the `adapter` option changes.

## Quick Comparison

| | IDBAdapter | MemoryAdapter | D1Adapter | KVAdapter | LocalStorageAdapter | SQLiteAdapter | PostgresAdapter | RedisAdapter | TursoAdapter |
|---|---|---|---|---|---|---|---|---|---|
| **Runtime** | Browser | Anywhere | CF Workers | CF Workers | Browser | Node.js | Node.js | Node.js | Node.js / Edge |
| **Persistence** | Persistent | In-memory | Persistent | Persistent | Persistent | Persistent | Persistent | Persistent | Persistent |
| **Capacity** | ~50MB+ | RAM | 10GB | Unlimited | ~5MB | Unlimited | Unlimited | RAM/Disk | Unlimited |
| **Best for** | Browser apps | Testing, SSR | Edge CRUD | Config, sessions | Simple browser | Server apps | Production | Caching, queues | Edge databases |
| **Range queries** | Native | JS sort | SQL WHERE | JS-side | JS-side | SQL WHERE | SQL WHERE | Sorted sets | SQL WHERE |
| **Transactions** | Native IDB | Snapshot | Snapshot | Best-effort | Snapshot | SAVEPOINT | BEGIN/COMMIT | MULTI/EXEC | Snapshot |
| **Watch** | Yes + cross-tab | Yes (local) | Yes (local) | Yes (local) | Yes (local) | Yes (local) | Yes (local) | Yes (local) | Yes (local) |
| **Indexes** | Native | Simulated | SQL indexes | Prefix-based | Simulated | SQL indexes | SQL indexes | Sorted sets | SQL indexes |

## IDBAdapter (Browser)

The default adapter. Uses the browser's IndexedDB API directly.

```javascript
import { EasyDB } from '@rckflr/easydb';
// IDBAdapter is auto-detected in browsers
const db = await EasyDB.open('myApp', { schema(s) { ... } });
```

**Strengths:**
- Native browser storage — no server needed
- True persistent storage surviving page reloads
- Native range queries via IDBKeyRange (fast)
- Native transactions with real atomicity
- Cross-tab reactivity via BroadcastChannel

**Limitations:**
- Browser-only (no Node.js, no Workers)
- Transactions auto-commit when the event loop is idle
- No compound indexes

**Best for:** Progressive web apps, offline-first apps, browser-based tools.

---

## MemoryAdapter

In-memory storage using `Map` and `Array`. Data is lost when the process exits.

```javascript
import { EasyDB, MemoryAdapter } from '@rckflr/easydb';

const db = await EasyDB.open('test', {
  adapter: new MemoryAdapter(),
  schema(s) { ... }
});
```

**Strengths:**
- Works anywhere — browser, Node.js, Deno, Bun
- Fastest adapter (no I/O)
- Perfect for unit tests — fresh state per test
- `structuredClone` for mutation safety

**Limitations:**
- No persistence — data lost on process exit
- No cross-tab sync
- Memory-limited

**Best for:** Unit tests, SSR/server rendering, prototyping, serverless functions needing temporary state.

---

## D1Adapter (Cloudflare Workers)

Maps EasyDB operations to SQL queries against Cloudflare D1 (SQLite at the edge).

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
    return Response.json(await db.users.where('role', 'admin').toArray());
  }
};
```

**Strengths:**
- Persistent SQLite storage at the edge
- Range queries map to SQL WHERE (native, fast)
- Auto-generates CREATE TABLE from schema
- SQL identifier escaping prevents injection
- Up to 10GB per database

**Limitations:**
- Cloudflare Workers runtime only
- Transactions are emulated (snapshot + rollback), not native
- `.filter()` is JS-side (post-query)

**Best for:** Edge API backends, CRUD apps on Cloudflare Workers, replacing REST + database combos.

---

## KVAdapter (Cloudflare Workers)

Maps EasyDB operations to Cloudflare KV — a global, eventually-consistent key-value store.

```javascript
import { EasyDB, KVAdapter } from '@rckflr/easydb';

export default {
  async fetch(request, env) {
    const db = await EasyDB.open('app', {
      adapter: new KVAdapter(env.MY_KV),
      schema(s) {
        s.createStore('settings', { key: 'name' });
      }
    });
    return Response.json(await db.settings.get('theme'));
  }
};
```

**Strengths:**
- Globally distributed — reads from nearest edge location
- Unlimited storage
- Simple key-value operations are very fast
- Supports autoIncrement, unique indexes, range queries

**Limitations:**
- Eventually consistent (writes take ~60s to propagate globally)
- List/query operations fetch all keys then filter JS-side
- Transactions are best-effort (no true atomicity)
- Higher latency for write-heavy workloads

**Best for:** Configuration storage, feature flags, session data, user preferences — read-heavy workloads where eventual consistency is acceptable.

---

## LocalStorageAdapter (Browser)

Uses the browser's `localStorage` API. Stores entire database as a JSON blob.

```javascript
import { EasyDB } from '@rckflr/easydb';
import { LocalStorageAdapter } from '@rckflr/easydb/adapters/localstorage';

const db = await EasyDB.open('app', {
  adapter: new LocalStorageAdapter(),
  schema(s) {
    s.createStore('settings', { key: 'name' });
  }
});
```

**Strengths:**
- Dead simple — synchronous read/write under the hood
- Works in all browsers including older ones
- Data survives page reloads
- Small footprint

**Limitations:**
- ~5MB storage limit per origin
- Synchronous blocking API (localStorage itself)
- Entire database serialized/deserialized on each operation
- Not suitable for large datasets

**Best for:** Small user preferences, simple settings, prototypes where IndexedDB is overkill.

---

## SQLiteAdapter (Node.js)

Uses `better-sqlite3` for file-based or in-memory SQLite storage.

```javascript
import { EasyDB } from '@rckflr/easydb';
import { SQLiteAdapter } from '@rckflr/easydb/adapters/sqlite';

const db = await EasyDB.open('app', {
  adapter: new SQLiteAdapter('./data.db'),
  schema(s) {
    s.createStore('users', { key: 'id', indexes: ['email'] });
  }
});
```

**Strengths:**
- Fast file-based persistence (WAL mode enabled)
- Real SQL queries for range operations
- True transaction support via SAVEPOINT
- In-memory mode with `:memory:` for testing
- No external services required

**Limitations:**
- Node.js only (requires `better-sqlite3` native module)
- Single-process access (file locking)
- Not available in browsers or edge runtimes

**Best for:** CLI tools, Electron apps, local-first Node.js services, embedded databases.

---

## PostgresAdapter (Node.js)

Connects to PostgreSQL via `pg` (node-postgres) or Neon serverless driver.

```javascript
import { EasyDB } from '@rckflr/easydb';
import { PostgresAdapter } from '@rckflr/easydb/adapters/postgres';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await EasyDB.open('app', {
  adapter: new PostgresAdapter(pool),
  schema(s) {
    s.createStore('users', { key: 'id', indexes: ['email'] });
  }
});
```

**Strengths:**
- Production-grade relational database
- True ACID transactions via BEGIN/COMMIT/ROLLBACK
- SQL-native range queries and indexes
- Works with connection pools, managed databases (Neon, Supabase, RDS)
- Custom schema support (`new PostgresAdapter(pool, { schema: 'myapp' })`)

**Limitations:**
- Requires running PostgreSQL server
- Higher latency than in-process databases
- No browser support

**Best for:** Production APIs, multi-tenant SaaS backends, any app already using PostgreSQL.

---

## RedisAdapter (Node.js)

Connects to Redis via `ioredis` or `@upstash/redis`.

```javascript
import { EasyDB } from '@rckflr/easydb';
import { RedisAdapter } from '@rckflr/easydb/adapters/redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const db = await EasyDB.open('app', {
  adapter: new RedisAdapter(redis),
  schema(s) {
    s.createStore('sessions', { key: 'sid' });
  }
});
```

**Strengths:**
- Extremely fast in-memory store
- Range queries via sorted sets
- MULTI/EXEC for atomic operations
- Custom key prefix (`new RedisAdapter(redis, { prefix: 'myapp:' })`)
- Works with Upstash for serverless Redis

**Limitations:**
- Data in memory by default (persistence via RDB/AOF)
- Requires running Redis server
- No browser support

**Best for:** Session storage, caching layers, real-time leaderboards, rate limiting, message queues.

---

## TursoAdapter (Node.js / Edge)

Connects to Turso (libSQL) via `@libsql/client`. Works with both local SQLite and remote Turso databases.

```javascript
import { EasyDB } from '@rckflr/easydb';
import { TursoAdapter } from '@rckflr/easydb/adapters/turso';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});
const db = await EasyDB.open('app', {
  adapter: new TursoAdapter(client),
  schema(s) {
    s.createStore('users', { key: 'id', indexes: ['role'] });
  }
});
```

**Strengths:**
- SQLite at the edge with global replication
- Embedded replicas for ultra-low-latency reads
- SQL-native range queries and indexes
- Works locally (file:path or :memory:) and remotely
- Compatible with any libSQL client

**Limitations:**
- Transactions are emulated (snapshot + rollback)
- Requires Turso account for remote databases
- Newer service — smaller ecosystem than PostgreSQL

**Best for:** Edge-native applications, multi-region deployments, apps needing SQLite simplicity with global distribution.

---

## Choosing an Adapter

```
Is your app in a browser?
  ├─ Need robust storage (>5MB)? → IDBAdapter (default, auto-detected)
  └─ Just need small settings? → LocalStorageAdapter

Is it a Cloudflare Worker?
  ├─ Need SQL-like queries / transactions? → D1Adapter
  └─ Need global distribution / simple KV? → KVAdapter

Is it Node.js?
  ├─ Already have PostgreSQL? → PostgresAdapter
  ├─ Need Redis for caching/sessions? → RedisAdapter
  ├─ Want embedded SQLite (no server)? → SQLiteAdapter
  └─ Need edge-replicated SQLite? → TursoAdapter

Is it a test / SSR / prototype?
  └─ Yes → MemoryAdapter
```

## Adapter Auto-Detection

If you don't specify an adapter, EasyDB picks one automatically:

| Environment | Detected Adapter |
|-------------|-----------------|
| Browser (has `indexedDB`) | IDBAdapter |
| Node.js / Deno / Bun | MemoryAdapter |

For all other adapters, you must pass the adapter explicitly because they require runtime bindings or connections.
