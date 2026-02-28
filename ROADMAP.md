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

## Phase 0 — Foundation (v0.1.0–v0.2.0) ✅

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

### TypeScript support ✅

- [x] Add type definitions for the full API
- [x] Generic schema type: `EasyDB.open<MySchema>('db', ...)`
- [x] Typed store access: `db.users.get(1)` returns `Promise<User | undefined>`
- [x] Export `.d.ts` alongside `.js`

### Testing ✅

- [x] Set up vitest with fake-indexeddb
- [x] Unit tests for QueryBuilder (all operators, edge cases)
- [x] Unit tests for StoreAccessor (CRUD, batch, error handling)
- [x] Unit tests for transactions (commit, rollback, nested reads)
- [x] Unit tests for watch (emit on put/delete/clear, filter by key)
- [x] Fast path validation (verify getAll is used when expected)

### Bug fixes & edge cases ✅

- [x] Handle store name collision with EasyDB methods (`db.store('transaction')`)
- [x] Validate store exists before operations (friendly error listing available stores)

### Developer experience ✅

- [x] Better error messages: "Store 'users' not found. Available stores: orders, products"
- [x] `db.stores` getter to list available store names
- [x] `db.version` — current database version

---

## Phase 2 — Adapter Architecture (v0.4.0) ✅

### Define the adapter interface ✅

- [x] `StorageAdapter` interface with methods: `get`, `put`, `delete`, `getAll`, `count`, `cursor`, `transaction`
- [x] Move IndexedDB-specific code into `adapters/indexeddb.js`
- [x] EasyDB core becomes adapter-agnostic

### In-memory adapter ✅

- [x] Full adapter implementation using Map/Array
- [x] Useful for: testing, SSR, serverless functions
- [x] Supports all query operations (unique indexes, autoIncrement)
- [x] structuredClone for mutation safety

### Schema migrations ✅

- [x] Versioned migrations with `migrations: { 1: fn, 2: fn }` syntax
- [x] Auto-infers version from highest key
- [x] Only runs migrations newer than current version

---

## Phase 3 — Edge Adapters (v0.5.0) ✅

### Cloudflare D1 adapter ✅

- [x] Map EasyDB operations to D1 SQL queries
- [x] Auto-generate CREATE TABLE from schema definition
- [x] Range queries map to SQL WHERE clauses (native, fast)
- [x] Transactions with snapshot/rollback
- [x] `.filter()` remains JS-side (post-query)
- [x] Cursor/async iterable over D1 result sets
- [x] SQL identifier escaping prevents injection

### Cloudflare KV adapter ✅

- [x] Map get/put/delete to KV operations
- [x] Store metadata for indexes via prefix scheme (`{prefix}r:{store}:{pk}`, `{prefix}m:{store}`)
- [x] List operations for `.all()` and `.where()` (fetch all + JS filter)
- [x] autoIncrement, unique indexes, range queries
- [x] Best-effort transactions with rollback

### Cross-environment portability

- [x] Same app code works in browser (IndexedDB) and Workers (D1/KV)
- [x] Adapter auto-detection: `EasyDB.open('db')` picks IDBAdapter (browser) or MemoryAdapter (Node/SSR) automatically
- [x] Shared test patterns across all adapters (275 tests)

---

## Phase 4 — Sync & Reactivity (v0.5.0–v0.6.0) ✅

### Cross-tab watch ✅

- [x] BroadcastChannel integration for multi-tab reactivity
- [x] Graceful degradation when BroadcastChannel is unavailable

### Framework integrations

- [x] React hook: `useQuery(db.users.where('role', 'admin'))` + `useRecord(db.users, key)`
- [x] Vue composable: `useQuery(query)` + `useRecord(store, key)` with `ref()` reactivity
- [x] Svelte store: `queryStore(query)` + `recordStore(store, key)` with subscribe contract
- [x] All hooks auto-refresh via watch when underlying data changes

### Pagination ✅

- [x] `skip(n)` and `page(pageNum, pageSize)` on QueryBuilder
- [x] Fast path uses `getAll(skip+limit)` then slices
- [x] Works with `filter()`, `desc()`, `where()`

---

## Phase 5 — Ecosystem (v1.0.0)

**Goal:** Stable API, npm publish, documentation site, community.

### Stability

- [ ] API freeze — no breaking changes after 1.0
- [x] Performance benchmarks (`npm run bench`)
- [ ] Bundle size tracking (target: <5KB gzipped for core + 1 adapter)
- [ ] Browser compatibility matrix

### Distribution

- [ ] Publish to npm as `@aspect/easydb` (package ready, needs `npm login`)
- [ ] CDN builds (ESM, UMD, IIFE)

### Documentation site

- [ ] Hosted docs (likely on Cloudflare Pages)
- [ ] Interactive playground (evolved from current demo)
- [ ] Migration guide from Dexie.js and raw IndexedDB
- [ ] Adapter comparison guide

### Community

- [ ] Blog post: "Why we built EasyDB" (publish on Automators.work and Dev.to)
- [ ] GitHub Discussions for feedback and RFC process
- [ ] Contributing guide

---

## Non-Goals

Things we're intentionally NOT doing:

- **Replacing Dexie.js** — They have 10+ years head start on IndexedDB specifically. We differentiate on multi-backend portability.
- **Building a full ORM** — No relations, no schema validation beyond types. Keep it document/KV oriented.
- **SQL support** — If you need JOINs and GROUP BY, use D1 or SQLite directly. EasyDB is for document-style access patterns.
- **Replicating PouchDB** — CouchDB-style sync is complex and niche. Offline-first sync is a stretch goal, not a core feature.
- **Supporting legacy browsers** — ES2018+ only (async iterables). No IE11, no transpilation.

---

## Priority Matrix

| Phase | Impact | Effort | Status |
|-------|--------|--------|--------|
| 0. Foundation | — | — | ✅ Done |
| 1. Hardening | Medium | Low | ✅ Done |
| 2. Adapter arch | High | Medium | ✅ Done |
| 3. Edge adapters | **Very High** | High | ✅ Done |
| 4. Sync & React | High | High | ✅ Done |
| 5. Ecosystem | Medium | Medium | 🔄 In progress |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-28 | Start as IndexedDB POC | Prove the API design with a real backend |
| 2026-02-28 | Pivot vision to multi-backend | IndexedDB wrapper alone can't compete with Dexie |
| 2026-02-28 | Prioritize D1 adapter | Aligns with Cloudflare ecosystem, unique differentiator |
| 2026-02-28 | TypeScript declarations | Required for DX and adoption |
| 2026-02-28 | Adapter interface contract | Minimal enough that new adapters are <300 LOC |
| 2026-02-28 | KV adapter + React hooks | High impact, moderate effort — completes edge story and framework reach |
