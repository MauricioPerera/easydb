# Design Document

## Philosophy

EasyDB applies the principles from Cloudflare's ["We deserve a better streams API"](https://blog.cloudflare.com/a-better-web-streams-api/) blog post to IndexedDB:

> The problems aren't bugs; they're consequences of design decisions that may have made sense a decade ago, but don't align with how JavaScript developers write code today.

IndexedDB was designed in 2011 with DOM events, before `async/await` (ES2017), async iterables (ES2018), and `Proxy` (ES2015) existed. EasyDB demonstrates that a thin layer (~250 LOC) using these modern primitives can eliminate ~85% of the boilerplate.

## Key Design Decisions

### 1. Proxy-based store access

```javascript
db.users.get(1)  // vs db.transaction('users', 'readonly').objectStore('users').get(1)
```

The `EasyDB` constructor returns a `Proxy` that intercepts property access and returns a `StoreAccessor` dynamically. This means stores don't need to be registered — any property name is assumed to be a store name.

**Tradeoff:** No compile-time validation of store names. TypeScript generics could solve this with a schema type parameter.

### 2. True pull-based cursors

V1 had a critical design flaw: the cursor advanced eagerly via `cursor.continue()` in the `onsuccess` handler, buffering all results regardless of consumption.

V2 implements true pull semantics:

```
Consumer calls next() → waits on promise → onsuccess resolves promise → yields value → cursor.continue()
```

The cursor only advances when the consumer requests the next value. `break` in `for await` triggers `return()` which sets `done = true`, stopping the cursor.

This directly mirrors Snell's pull-through transforms: data flows on-demand from source to consumer.

### 3. Fast paths over cursors

Not every query needs a cursor. When the query has no `.filter()` (JS-side predicate) and no `.limit()`, we can use `getAll(keyRange)` which is significantly faster — the IDB engine handles everything internally without creating per-record promises.

Similarly, `count()` uses `IDBObjectStore.count(keyRange)` when there's no JS filter, avoiding loading any records at all.

**Rule:** Use the IDB engine when possible, fall back to JS cursor iteration when needed.

### 4. Immutable query builder

Every modifier (`.limit()`, `.filter()`, `.gt()`, etc.) returns a new `QueryBuilder` via `_clone()`. This makes queries composable and reusable:

```javascript
const adults = db.users.where('age').gte(18);
const youngAdults = adults.lt(30);           // doesn't modify `adults`
const firstThree = youngAdults.limit(3);     // doesn't modify `youngAdults`
```

### 5. Watch via in-memory EventTarget

V1 used `BroadcastChannel` for watch, but writes through EasyDB never emitted to the channel — it was dead code.

V2 uses a simple in-memory Map of callbacks. Every write method (`put`, `delete`, `clear`, `putMany`) calls `_notify()` which dispatches to registered watchers.

**Tradeoff:** Only works within the same EasyDB instance. Cross-tab observation would require BroadcastChannel, which adds complexity and isn't needed for most POC use cases.

### 6. Transactions as async callbacks

IndexedDB transactions auto-commit when there are no pending requests in the event loop. This means you can't `await` non-IDB operations inside a transaction.

EasyDB wraps the transaction in a try/catch async callback:

```javascript
await db.transaction(['store'], async (tx) => {
  // Only IDB operations here
  const item = await tx.store.get(1);
  await tx.store.put({ ...item, updated: true });
  // throw → auto abort
});
```

**Known limitation:** If the callback does `await fetch()` or any non-IDB async work, the transaction will auto-commit prematurely. This is an IndexedDB engine limitation, not an EasyDB bug.

## What This Is Not

- **Not a Dexie.js replacement** — Dexie has 10+ years of battle-testing, advanced live queries, and comprehensive edge case handling.
- **Not an ORM** — No schema validation, no relations, no migrations beyond basic `createStore`.
- **Not production-ready** — This is a proof of concept to demonstrate that modern JS primitives can dramatically simplify IndexedDB usage.
- **Not a new storage engine** — EasyDB is a thin wrapper. All data is stored in IndexedDB.

## Future Directions (if this becomes a real project)

1. **TypeScript generics** — `EasyDB.open<MySchema>(...)` for type-safe store access
2. **Cross-tab watch** — BroadcastChannel integration for multi-tab reactivity
3. **Backend adapters** — Same API surface over D1 (Cloudflare), SQLite (Node.js), KV (edge)
4. **Migrations** — Declarative schema versioning with data migration callbacks
5. **Batch cursors** — Yield `Uint8Array[]`-style batches for high-throughput scenarios (Snell's batched chunks concept applied to records)
