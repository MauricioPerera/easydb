# Adapter Comparison Guide

EasyDB supports multiple storage backends via its adapter architecture. All adapters expose the same API, so your application code stays identical — only the `adapter` option changes.

## Quick Comparison

| | IDBAdapter | MemoryAdapter | D1Adapter | KVAdapter |
|---|---|---|---|---|
| **Runtime** | Browser | Anywhere | Cloudflare Workers | Cloudflare Workers |
| **Persistence** | Persistent | In-memory only | Persistent (SQLite) | Persistent (KV) |
| **Capacity** | ~50MB–unlimited | RAM-limited | 10GB per DB | Unlimited |
| **Best for** | Browser apps | Testing, SSR | Edge CRUD apps | Config, sessions |
| **Gzip (+ core)** | 4.4 KB | 5.3 KB | 6.6 KB | 6.3 KB |
| **Range queries** | Native (IDBKeyRange) | JS sort + slice | SQL WHERE | JS-side |
| **Transactions** | Native IDB transactions | Snapshot + rollback | Snapshot + rollback | Best-effort rollback |
| **Watch/reactivity** | Yes + cross-tab | Yes (local only) | Yes (local only) | Yes (local only) |
| **Indexes** | Native | Simulated (Map) | SQL indexes | Prefix-based |

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

## Choosing an Adapter

```
Is your app in a browser?
  └─ Yes → IDBAdapter (default, auto-detected)

Is it a Cloudflare Worker?
  └─ Need SQL-like queries / transactions? → D1Adapter
  └─ Need global distribution / simple KV? → KVAdapter

Is it a test / SSR / prototype?
  └─ Yes → MemoryAdapter

Is it Node.js / Deno / Bun (persistent)?
  └─ Write a custom adapter (see CONTRIBUTING.md)
```

## Adapter Auto-Detection

If you don't specify an adapter, EasyDB picks one automatically:

| Environment | Detected Adapter |
|-------------|-----------------|
| Browser (has `indexedDB`) | IDBAdapter |
| Node.js / Deno / Bun | MemoryAdapter |

For Cloudflare adapters (D1, KV), you must pass the adapter explicitly because they require runtime bindings (`env.DB`, `env.MY_KV`).
