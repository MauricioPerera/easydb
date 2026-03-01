# Changelog

## v1.2.0 — 2026-02-28

### New Features
- **SyncEngine** — Cross-adapter database synchronization (`@rckflr/easydb/sync`)
  - Push mode: watch-based real-time replication from source to target
  - Pull mode: polling-based replication from target to source
  - Bidirectional mode: watch-based sync in both directions with re-entrancy guard
  - One-time full sync via `syncAll()` and `syncStore()`
  - Configurable conflict resolution: `source-wins`, `target-wins`, `last-write-wins`, `manual`
  - Custom `onConflict` callback for manual merge logic
  - Pause/resume with event queuing
  - `onSync` and `onError` callbacks for monitoring
  - `addListener()` public API for multi-consumer sync status tracking with `onSync`, `onError`, and `onStatusChange` callbacks
  - Order-insensitive deep equality for conflict detection (replaces fragile `JSON.stringify`)
  - 38 tests covering push, pull, bidirectional, conflicts, lifecycle, listeners, and edge cases
- **Sync status hooks** — reactive sync monitoring for all 7 frameworks
  - React: `useSyncStatus(syncEngine)` → `{ running, paused, lastEvent, error }`
  - Vue: `useSyncStatus(syncEngine)` → reactive `Ref<>` values with `onUnmounted` cleanup
  - Svelte: `syncStatusStore(syncEngine)` → Svelte store contract (`$status.running`, etc.)
  - Angular: `createSyncStatus(syncEngine)` → readonly `Signal<>` values with `DestroyRef` cleanup
  - Solid.js: `createSyncStatus(syncEngine)` → `Accessor<>` values with `onCleanup`
  - Preact: `useSyncStatus(syncEngine)` → same API as React
  - Lit: `EasyDBSyncStatusController` → `ReactiveController` with `hostConnected`/`hostDisconnected`
  - 27 tests across all seven frameworks

### Improved
- **Proxy `has()` trap** — `'storeName' in db` now returns `true` for store names
- **StoreAccessor caching** — `db.users === db.users` now returns `true`; accessors are cached per store name
- **Extracted `_assertStore`** — deduplicated store validation logic from `QueryBuilder` and `StoreAccessor`
- **Watcher error handling** — async watcher loops in all 7 framework hooks now catch errors and surface them via the `error` state instead of silently hanging

### Fixed
- **Adapter type declarations** — 5 adapter `.d.ts` files incorrectly re-exported from main module; now properly declare types from their own files
- **Lifecycle notifications** — `start()`/`stop()`/`pause()`/`resume()` now notify listeners via `onStatusChange`, fixing stale `running`/`paused` state in hooks
- **React/Preact stale closure** — watcher `refresh()` now reads from `queryRef.current` instead of closure variable
- **`count()` fast path** — now correctly falls back to slow path when `skip()` or `limit()` are applied
- **Unsafe listener iteration** — `_emitSync`/`_handleError` now iterate a copy of the listeners array, preventing skipped callbacks when a listener unsubscribes during dispatch
- **Angular double-fetch** — `createQuery()` and `createRecord()` with function input no longer call `refresh()` twice on initialization
- **`last-write-wins` timestamps** — uses `?? 0` instead of `|| 0` to correctly handle falsy timestamp values like `0`
- **CHANGELOG v1.1.0** — corrected stale API names for Angular, Solid.js, Preact, and Lit
- **IDB `onblocked` handler** — `open()` now rejects with `VersionError` instead of hanging silently when another tab holds an old connection
- **D1 rollback error preservation** — if rollback itself fails, the original error is now thrown with `rollbackError` attached instead of being swallowed
- **SQLite re-entrant transactions** — unique savepoint names (`easydb_txn_N`) replace the fixed `easydb_txn` name that broke nested calls
- **Postgres `putMany` nesting** — replaced raw `BEGIN`/`COMMIT` with `SAVEPOINT`/`RELEASE` so `putMany()` nests safely inside `transaction()`
- **Redis atomic auto-increment** — uses Redis `INCR` instead of read-modify-write on a JSON blob, fixing race conditions across multiple instances
- **Redis/KV schema upgrade** — upgrading schema version no longer drops stores not re-declared in the new schema; existing stores are merged in
- **Redis/KV `count()` fast-path** — removed unnecessary `!opts.index` guard (same fix previously applied to Memory adapter)
- **Framework `.d.ts` exports** — all interfaces in Vue, Svelte, Angular, Solid.js, Preact, and Lit type declarations are now exported, fixing broken TypeScript inference for consumers

### Testing
- 739 tests total (up from 662)

## v1.1.0 — 2026-02-28

### New Storage Adapters
- **LocalStorageAdapter** — browser localStorage for simple persistence
- **SQLiteAdapter** — better-sqlite3 with WAL mode and SAVEPOINT transactions
- **PostgresAdapter** — PostgreSQL via pg/node-postgres or Neon serverless
- **RedisAdapter** — Redis via ioredis or @upstash/redis
- **TursoAdapter** — Turso/libSQL for edge-replicated SQLite

### New Framework Integrations
- **Angular** — `createQuery()` / `createRecord()` with Angular 16+ signals
- **Solid.js** — `createQuery()` / `createRecord()` with Solid signals
- **Preact** — `useQuery()` / `useRecord()` with Preact hooks
- **Lit** — `EasyDBQueryController` / `EasyDBRecordController` ReactiveControllers for web components

### Testing
- Adapter conformance test suite covering Memory, localStorage, SQLite
- Framework integration tests for Angular, Solid, Preact, React, Vue
- 662 tests total (up from 308)

### Fixed
- `empty-adapter.js` now stubs all 6 server adapters (was missing Postgres, Redis, Turso, SQLite)
- `AdapterConnection.putMany` return type corrected from `Promise<void>` to `Promise<any[]>`
- Stale import paths in D1 and KV adapter doc comments

### Changed
- Per-adapter TypeScript declaration files for direct imports
- Updated README with all 9 adapters and 7 framework integrations
- Updated `docs/ADAPTERS.md` with comprehensive guide for all adapters
- CI workflow metrics now include all adapters
- Benchmarks now include SQLite and localStorage adapters
- Added missing keywords to package.json (react, vue, svelte)
- Usage examples (`examples/adapters.js`, `examples/frameworks.js`)

## v1.0.1 — 2026-02-28

### Bug Fixes
- **close() guard** — accessing stores, calling `store()`, or starting transactions after `db.close()` now throws `"EasyDB: Database is closed"` immediately instead of failing deep in the adapter.
- **putMany watch notifications** — watchers now receive the correct key for each record (including auto-generated keys), instead of `undefined` for autoIncrement stores.
- **D1 autoIncrement back-patch** — `put()` with autoIncrement now also updates index columns in the back-patch UPDATE, keeping SQL indexes in sync with the `_value` JSON.
- **All adapters putMany** — `putMany()` now returns an array of keys across all 4 adapters (IDB, Memory, D1, KV), enabling accurate watch notifications.

### Tests
- 19 new robustness tests covering close() guard, putMany key tracking, autoIncrement watch events, limit(0), skip beyond results, desc().limit(), getMany with mixed keys, and error cases.
- Test count: 289 → 308.

## v1.0.0 — 2026-02-28

### API Freeze
- **Stable API** — no breaking changes from this point forward. The public API (EasyDB.open, store accessors, QueryBuilder, watch, transactions, adapters) is frozen.

### New Features
- **CDN builds** — pre-built ESM (`easydb.mjs.js`), IIFE (`easydb.iife.js`), and UMD (`easydb.umd.js`) bundles in `dist/`. Build with `npm run build`.
- **Bundle size tracking** — build script reports sizes and enforces <5KB gzip target (currently 4.4KB).

### Documentation
- Browser compatibility matrix (`docs/BROWSER_COMPATIBILITY.md`)
- Migration guide from raw IndexedDB and Dexie.js (`docs/MIGRATION.md`)
- Adapter comparison guide (`docs/ADAPTERS.md`)
- Contributing guide (`docs/CONTRIBUTING.md`)

### Updated
- Package renamed to `@rckflr/easydb` for npm publication.
- README updated with CDN bundle sizes, documentation links, and 289 test count.
- All 5 roadmap phases completed.

## v0.7.0 — 2026-02-28

### New Features
- **Adapter auto-detection** — When no `adapter` option is provided, EasyDB detects the runtime environment. Uses `IDBAdapter` when `indexedDB` is available (browser), falls back to `MemoryAdapter` otherwise (Node.js, SSR, serverless). D1/KV adapters still require explicit configuration.
- **Vue composables** — `useQuery(query)` and `useRecord(store, key)` with Vue 3 `ref()` reactivity and auto-refresh via `watch()`. Supports reactive refs as query/key inputs. Vue 3 is an optional peer dependency.
- **Svelte stores** — `queryStore(query)` and `recordStore(store, key)` implement the Svelte store contract (`subscribe`). Lazy watcher setup (only when subscribed). Works with Svelte 3/4/5.

### Updated
- ROADMAP.md updated to reflect Phase 0–4 completion status.
- 289 tests across 12 test files (4 adapters + 3 framework integrations).
- Sub-path exports: `@rckflr/easydb/vue`, `@rckflr/easydb/svelte`.
- Optional peer dependencies for Vue (>=3) and Svelte (>=3).

## v0.6.0 — 2026-02-28

### New Features
- **KV Adapter** — Cloudflare Workers KV backend. Stores records as individual KV entries with prefix-based namespacing. Supports autoIncrement, unique indexes, range queries (JS-side filtering), and best-effort transactions with rollback.
- **React hooks** — `useQuery(query)` and `useRecord(store, key)` with auto-refresh via `watch()`. Returns `{ data, loading, error, refresh }`. React is an optional peer dependency.
- **Generic TypeScript** — `EasyDB.open<Schema>()` returns fully typed store accessors. `db.users.get(1)` returns `Promise<Schema['users'] | undefined>`. Typed transactions, typed `store()`.

### Updated
- TypeScript declarations for KVAdapter and React hooks.
- 275 tests across 10 test files (4 adapters).
- Sub-path exports: `@rckflr/easydb/adapters/kv`, `@rckflr/easydb/react`.

## v0.5.0 — 2026-02-28

### New Features
- **D1 Adapter** — Cloudflare Workers D1/SQLite backend. Each store maps to a SQL table with keyPath as primary key, `_value` column for full JSON, and separate columns for indexed fields.
- **Cross-tab watch** — Watch events broadcast to other browser tabs via BroadcastChannel. Graceful degradation when BroadcastChannel is unavailable.
- **Migrations API** — `migrations: { 1: fn, 2: fn }` as syntactic sugar over `schema(builder, oldVersion)`. Auto-infers version from highest key. Only runs migrations newer than current version.
- **Pagination** — `skip(n)` and `page(pageNum, pageSize)` on QueryBuilder. Fast path uses `getAll(skip+limit)` then slices. Works with `filter()`, `desc()`, `where()`.
- **Benchmarks** — `npm run bench` measures EasyDB vs raw IndexedDB overhead.

### Hardening
- D1 `transaction()` snapshots tables and rolls back on error.
- D1 `put()` uses `INSERT...RETURNING` for atomic autoIncrement key generation.
- D1 `putMany()` falls back to sequential `put()` for autoIncrement stores.
- SQL identifier escaping via `_esc()` prevents injection through store/index names.
- IDB `getMany()` now awaits transaction completion for consistency.

### Updated
- TypeScript declarations for D1Adapter, migrations, cross-tab watch, and pagination.
- CI pipeline with D1 adapter metrics.
- README rewrite for multi-backend release.

## v0.4.0 — 2026-02-28

### Breaking Changes
- EasyDB now uses a pluggable adapter architecture. The default adapter (IDBAdapter) is used automatically, so existing code works without changes.

### New Features
- **Adapter architecture** — pluggable storage backends implementing a common interface.
- **IDBAdapter** — extracted IndexedDB logic into its own adapter class.
- **MemoryAdapter** — in-memory adapter for testing, SSR, and serverless. Uses structuredClone for mutation safety. Supports unique indexes, autoIncrement, and transactions with rollback.

## v0.3.0 — 2026-02-28

### New Features
- **`db.stores`** — array of available store names.
- **`db.store(name)`** — explicit store access for names that collide with EasyDB methods (e.g., `db.store('transaction')`).
- **`db.version`** — current database version.
- **Friendly error messages** — store-not-found errors now list available stores.

### Updated
- TypeScript type declarations (`easydb.d.ts`).
- CI pipeline (GitHub Actions with Node 18/20/22 matrix).

## v0.2.0 — 2026-02-28

### Breaking Changes
- QueryBuilder now uses true pull-based cursor (behavior change for large datasets)

### Bug Fixes
- **QueryBuilder opened 2 transactions** — v1 opened a tx, discarded it, then opened tx2. Now uses a single transaction with true pull-based cursor.
- **count() loaded all records in memory** (`toArray().length`) — now uses native `IDBObjectStore.count(keyRange)`.
- **watch() never emitted events** — BroadcastChannel was configured but writes didn't emit. Now `StoreAccessor.put/delete/putMany/clear` notify watchers automatically.

### Performance
- **toArray() fast path** — when query has no `.filter()` or `.limit()`, uses `getAll(keyRange)` instead of cursor. Up to 10x faster on large datasets.
- **True pull-based cursor** — v1 called `cursor.continue()` immediately on `onsuccess`, eagerly buffering everything. v2 only advances cursor when consumer calls `next()`.

### New Features
- **Range queries** — `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.between()` generate native `IDBKeyRange`.
- **Compound filters** — `.filter(fn)` applies JS predicate over cursor results.
- **`getMany(keys[])`** — batch get in a single transaction.
- **Watch emits on mutations** — `put()`, `delete()`, `clear()`, `putMany()` all trigger watch observers.

## v0.1.0 — 2026-02-28

Initial proof of concept.

- Proxy-based store access (`db.users.get()`)
- Async iterable queries (`for await...of`)
- Basic query builder (`.where()`, `.limit()`, `.toArray()`, `.first()`)
- Transactions with auto-rollback
- Watch via BroadcastChannel (non-functional)
- `putMany()` batch inserts
