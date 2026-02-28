# Roadmap

## Vision

EasyDB started as a proof of concept to reimagine IndexedDB with modern JavaScript primitives. But the real opportunity isn't competing with Dexie.js on IndexedDB wrappers — it's the **interface itself** as a universal storage abstraction that works identically across browser, edge, and server.

Think Drizzle for SQL, but for document/KV stores: same API, multiple backends, zero lock-in.

```
Same code everywhere:

  const user = await db.users.get(1);
  for await (const u of db.users.where('role', 'admin')) { ... }

     ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ IndexedDB│  │Cloudflare│  │  SQLite   │  │ In-Memory│
     │ (browser)│  │ D1 / KV  │  │ (Node.js) │  │  (test)  │
     └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## Phase 0 — Foundation (v0.2.0) ✅

Initial proof of concept.

- [x] Proxy-based store access
- [x] True pull-based async iterable cursors
- [x] Range queries via native IDBKeyRange
- [x] Compound filters with `.filter(fn)`
- [x] Transactions with auto-rollback
- [x] Reactive watch via async iterables
- [x] Fast paths (getAll, native count)
- [x] Batch operations (putMany, getMany)
- [x] Interactive demo/playground
- [x] Documentation (README, DESIGN, CHANGELOG)

---

## Phase 1 — Hardening (v0.3.0) ✅

**Completed.** TypeScript declarations, friendly errors, CI, watcher security fix.

**Timeline:** 2-3 weeks

### TypeScript support

- [ ] Add type definitions for the full API
- [ ] Generic schema type: `EasyDB.open<MySchema>('db', ...)`
- [ ] Typed store access: `db.users.get(1)` returns `Promise<User | undefined>`
- [ ] Typed query builder: `.where('role', 'admin')` validates index names
- [ ] Export `.d.ts` alongside `.js`

```typescript
interface Schema {
  users: { id: number; name: string; role: string; age: number };
  orders: { orderId: string; userId: number; total: number };
}

const db = await EasyDB.open<Schema>('myApp', { ... });
const user = await db.users.get(1); // type: Schema['users'] | undefined
```

### Testing

- [ ] Set up vitest with happy-dom or fake-indexeddb
- [ ] Unit tests for QueryBuilder (all operators, edge cases)
- [ ] Unit tests for StoreAccessor (CRUD, batch, error handling)
- [ ] Unit tests for transactions (commit, rollback, nested reads)
- [ ] Unit tests for watch (emit on put/delete/clear, filter by key)
- [ ] Integration tests with real IndexedDB (Playwright)
- [ ] Fast path validation (verify getAll is used when expected)

### Bug fixes & edge cases

- [ ] Handle store name collision with EasyDB methods (e.g. `db.transaction` vs store named "transaction")
- [ ] Proper cleanup on database close (cancel pending watchers)
- [ ] Error propagation in cursor iteration (tx abort mid-iteration)
- [ ] Handle `versionchange` events (another tab upgrades the DB)
- [ ] Validate store exists before operations (friendly error vs IDB cryptic error)

### Developer experience

- [ ] Better error messages: "Store 'users' not found. Available stores: orders, products"
- [ ] Debug mode: `EasyDB.open('db', { debug: true })` logs all operations
- [ ] `db.stores` getter to list available store names

---

## Phase 2 — Adapter Architecture (v0.4.0) ✅

**Completed.** Core refactored to adapter-agnostic interface. IDBAdapter + MemoryAdapter shipping.

**Timeline:** 3-4 weeks

### Define the adapter interface

- [ ] `StorageAdapter` interface with methods: `get`, `put`, `delete`, `getAll`, `count`, `cursor`, `transaction`
- [ ] `QueryCapabilities` — adapter declares what it supports natively (ranges, indexes, count) vs what needs JS fallback
- [ ] Move IndexedDB-specific code into `adapters/indexeddb.js`
- [ ] EasyDB core becomes adapter-agnostic

```
src/
├── core/
│   ├── easydb.js          # Main class, Proxy, adapter routing
│   ├── query-builder.js   # Query builder (adapter-aware)
│   ├── watch.js           # Watch engine
│   └── types.ts           # Shared types
├── adapters/
│   ├── indexeddb.js        # Browser IndexedDB
│   ├── memory.js           # In-memory (for testing)
│   └── interface.ts        # Adapter contract
└── index.js
```

### In-memory adapter

- [ ] Full adapter implementation using Map/Array
- [ ] Useful for: testing, SSR, serverless functions
- [ ] Supports all query operations
- [ ] Optional persistence to JSON (snapshot/restore)

```javascript
import { EasyDB } from '@aspect/easydb';
import { MemoryAdapter } from '@aspect/easydb/adapters/memory';

const db = await EasyDB.open('test', {
  adapter: new MemoryAdapter(),
  schema(db) { db.createStore('users', { key: 'id' }); }
});
```

### Schema migrations

- [ ] Versioned migrations with `up()` callbacks
- [ ] Access to stores during migration for data transforms
- [ ] Migration history tracking

```javascript
const db = await EasyDB.open('myApp', {
  version: 3,
  migrations: {
    1: (db) => {
      db.createStore('users', { key: 'id', indexes: ['email'] });
    },
    2: (db) => {
      db.createStore('orders', { key: 'id', indexes: ['userId'] });
    },
    3: async (db) => {
      db.users.createIndex('role');
      // Data migration
      for await (const user of db.users.all()) {
        await db.users.put({ ...user, role: user.role || 'member' });
      }
    }
  }
});
```

---

## Phase 3 — Edge Adapters (v0.5.0) ✅

**Completed.** D1Adapter maps EasyDB to Cloudflare D1/SQLite. Same API across browser, edge, and test.

**Timeline:** 4-6 weeks

### Cloudflare D1 adapter

- [ ] Map EasyDB operations to D1 SQL queries
- [ ] Auto-generate CREATE TABLE from schema definition
- [ ] Range queries map to SQL WHERE clauses (native, fast)
- [ ] Transactions map to D1 batch operations
- [ ] `.filter()` remains JS-side (post-query)
- [ ] Cursor/async iterable over D1 result sets

```javascript
import { EasyDB } from '@aspect/easydb';
import { D1Adapter } from '@aspect/easydb/adapters/d1';

export default {
  async fetch(request, env) {
    const db = await EasyDB.open('myApp', {
      adapter: new D1Adapter(env.DB),
      schema(db) {
        db.createStore('users', { key: 'id', indexes: ['role', 'country'] });
      }
    });

    // Same API as browser!
    const admins = await db.users.where('role', 'admin').limit(10).toArray();
    return Response.json(admins);
  }
};
```

### Cloudflare KV adapter

- [ ] Map get/put/delete to KV operations
- [ ] Store metadata for indexes in a separate KV namespace or prefix scheme
- [ ] List operations for `.all()` and `.where()` (KV list with prefix)
- [ ] Watch via Durable Objects or polling (optional)
- [ ] Best for: simple key-value patterns, configuration stores, caching

### Cross-environment portability

- [ ] Same app code works in browser (IndexedDB) and Workers (D1/KV)
- [ ] Adapter auto-detection: `EasyDB.open('db')` picks the right adapter based on environment
- [ ] Shared test suite that runs against all adapters

```javascript
// This code runs identically in browser and Workers
const db = await EasyDB.open('myApp', { schema: mySchema });
await db.users.put({ id: 1, name: 'Mauricio' });
const user = await db.users.get(1);
```

---

## Phase 4 — Sync & Reactivity (v0.6.0) 🔄

**Partially completed.** Cross-tab watch via BroadcastChannel shipped in v0.5.0. Migrations API shipped. Framework integrations and offline-first sync remain.

**Timeline:** 4-6 weeks

### Cross-tab watch (browser)

- [ ] BroadcastChannel integration for multi-tab reactivity
- [ ] Deduplicate events from same-instance writes
- [ ] Handle tab lifecycle (close, freeze, resume)

### Framework integrations

- [ ] React hook: `useQuery(db.users.where('role', 'admin'))`
- [ ] Vue composable: `useEasyDB(db.users.all())`
- [ ] Svelte store: `$: users = db.users.where('active', true)`
- [ ] All hooks auto-refresh via watch when underlying data changes

```jsx
// React
function AdminList() {
  const { data, loading } = useQuery(db.users.where('role', 'admin'));
  if (loading) return <Spinner />;
  return data.map(u => <UserCard key={u.id} user={u} />);
}
// Auto-refreshes when any admin is added/updated/deleted
```

### Offline-first sync (stretch goal)

- [ ] Define sync protocol between browser (IndexedDB) and edge (D1)
- [ ] Conflict resolution strategies (last-write-wins, merge function)
- [ ] Sync status observable via async iterable
- [ ] This is hard and may be better left to dedicated tools (like CRDTs)

---

## Phase 5 — Ecosystem (v1.0.0)

**Goal:** Stable API, npm publish, documentation site, community.

**Timeline:** 2-3 months after Phase 4

### Stability

- [ ] API freeze — no breaking changes after 1.0
- [ ] Performance benchmarks (automated, CI)
- [ ] Bundle size tracking (target: <5KB gzipped for core + 1 adapter)
- [ ] Browser compatibility matrix

### Distribution

- [ ] Publish to npm as `@aspect/easydb`
- [ ] CDN builds (ESM, UMD, IIFE)
- [ ] Separate adapter packages: `@aspect/easydb-d1`, `@aspect/easydb-kv`

### Documentation site

- [ ] Hosted docs (likely on Cloudflare Pages)
- [ ] Interactive playground (evolved from current demo)
- [ ] Migration guide from Dexie.js and raw IndexedDB
- [ ] Adapter comparison guide

### Community

- [ ] Blog post: "Why we built EasyDB" (publish on Automators.work and Dev.to)
- [ ] Reference the Cloudflare streams post as inspiration
- [ ] GitHub Discussions for feedback and RFC process
- [ ] Contributing guide

---

## Non-Goals

Things we're intentionally NOT doing:

- **Replacing Dexie.js** — They have 10+ years head start on IndexedDB specifically. We differentiate on multi-backend portability.
- **Building a full ORM** — No relations, no schema validation beyond types. Keep it document/KV oriented.
- **SQL support** — If you need JOINs and GROUP BY, use D1 or SQLite directly. EasyDB is for document-style access patterns.
- **Replicating PouchDB** — CouchDB-style sync is complex and niche. Offline-first sync in Phase 4 is a stretch goal, not a core feature.
- **Supporting legacy browsers** — ES2018+ only (async iterables). No IE11, no transpilation.

---

## Priority Matrix

| Phase | Status | Impact | Effort |
|-------|--------|--------|--------|
| 0. Foundation | ✅ Done | — | — |
| 1. Hardening | ✅ Done | — | — |
| 2. Adapter arch | ✅ Done | — | — |
| 3. Edge adapters | ✅ Done | — | — |
| 4. Sync & React | 🔄 Partial | High | High |
| 5. Ecosystem | ⏳ Next | Medium | Medium |

**Next milestone:** Framework integrations (React/Vue/Svelte hooks) and npm publish for v1.0.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-28 | Start as IndexedDB POC | Prove the API design with a real backend |
| 2026-02-28 | Pivot vision to multi-backend | IndexedDB wrapper alone can't compete with Dexie |
| 2026-02-28 | TypeScript declarations (not generics) | Ship DX value fast, generics come later |
| 2026-02-28 | Nested Map for watchers | Fix DoS vulnerability from prefix-matching close() |
| 2026-02-28 | Adapter interface via connection objects | Clean separation, adapters stay thin (~250 LOC each) |
| 2026-02-28 | D1 adapter with JSON _value column | Document-style storage over SQL, schema in _easydb_meta |
| 2026-02-28 | BroadcastChannel for cross-tab watch | Graceful degradation, no extra deps |
| 2026-02-28 | Declarative migrations API | Ergonomic alternative to raw schema callback |
| 2026-02-28 | skip() / page() pagination | Common need, trivial to implement correctly |
