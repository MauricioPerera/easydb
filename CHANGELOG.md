# Changelog

## v0.5.0 — 2026-02-28

### New Features
- **D1 Adapter** — Cloudflare Workers D1/SQLite backend. Each store maps to a SQL table with keyPath as primary key, `_value` column for full JSON, and separate columns for indexed fields.
- **Cross-tab watch** — Watch events broadcast to other browser tabs via BroadcastChannel. Graceful degradation when BroadcastChannel is unavailable.
- **Migrations API** — `migrations: { 1: fn, 2: fn }` as syntactic sugar over `schema(builder, oldVersion)`. Auto-infers version from highest key. Only runs migrations newer than current version.

### Hardening
- D1 `transaction()` snapshots tables and rolls back on error.
- D1 `put()` uses `INSERT...RETURNING` for atomic autoIncrement key generation.
- D1 `putMany()` falls back to sequential `put()` for autoIncrement stores.
- SQL identifier escaping via `_esc()` prevents injection through store/index names.
- IDB `getMany()` now awaits transaction completion for consistency.

### Updated
- TypeScript declarations for D1Adapter, migrations, and cross-tab watch.
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
