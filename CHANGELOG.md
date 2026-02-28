# Changelog

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
