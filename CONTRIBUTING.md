# Contributing to EasyDB

Thanks for your interest in contributing! EasyDB is a small, focused project — every contribution matters.

## Getting Started

```bash
git clone https://github.com/MauricioPerera/easydb.git
cd easydb
npm install
npm test
```

## Development Workflow

1. **Fork** the repo and create a branch from `main`
2. **Write tests** for any new functionality or bug fix
3. **Run the full test suite** before submitting: `npm test`
4. **Keep changes focused** — one feature or fix per PR
5. **Follow the existing code style** — no linter configured, just be consistent

## Project Structure

```
src/
├── easydb.js              # Core: EasyDB, QueryBuilder, StoreAccessor, watch
├── easydb.d.ts            # TypeScript declarations
└── adapters/
    ├── indexeddb.js        # Browser IndexedDB adapter (default)
    ├── memory.js           # In-memory adapter (testing, SSR, serverless)
    └── d1.js              # Cloudflare D1/SQLite adapter (Workers)

tests/
├── setup.js               # fake-indexeddb polyfill
├── helpers.js             # Shared test utilities
├── open.test.js           # Database lifecycle + migrations
├── crud.test.js           # CRUD operations (IDB)
├── query.test.js          # QueryBuilder: ranges, filters, pagination
├── transaction.test.js    # Multi-store transactions
├── watch.test.js          # Reactive observation + cross-tab
├── dx.test.js             # Developer experience (errors, store access)
├── fixes.test.js          # Regression tests for specific bugs
├── memory.test.js         # MemoryAdapter full coverage
├── d1-mock.js             # MockD1Database (better-sqlite3)
└── d1.test.js             # D1Adapter full coverage

benchmarks/
└── run.js                 # Performance benchmarks

demo/
└── index.html             # Interactive browser playground
```

## Writing Tests

Tests use [Vitest](https://vitest.dev/) with [fake-indexeddb](https://github.com/nicolo-ribaudo/fake-indexeddb) for Node.js IDB simulation.

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDB, destroyTestDB, seedUsers } from './helpers.js';

describe('My feature', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should do the thing', async () => {
    await db.users.put({ id: 1, name: 'Test', email: 't@t.com', role: 'admin', country: 'UY', age: 30 });
    const user = await db.users.get(1);
    expect(user.name).toBe('Test');
  });
});
```

Each test gets a fresh database with a unique name — no state leaks.

## Writing Adapters

If you want to add a new adapter (Redis, Turso, PlanetScale, etc.), implement the connection interface:

```javascript
class MyConnection {
  get name() {}           // database name
  get version() {}        // schema version
  get storeNames() {}     // string[]
  hasStore(name) {}       // boolean
  getKeyPath(store) {}    // string | null
  close() {}

  // CRUD
  async get(store, key) {}
  async getAll(store, opts?) {}  // opts: { index?, range?, limit? }
  async getMany(store, keys) {}
  async count(store, opts?) {}   // opts: { index?, range? }
  async put(store, value) {}     // returns key
  async delete(store, key) {}
  async clear(store) {}
  async putMany(store, items) {}

  // Cursor — async generator
  async *cursor(store, opts?) {} // opts: { index?, range?, direction? }

  // Transaction
  async transaction(storeNames, fn) {} // fn receives proxy, throw = rollback
}

class MyAdapter {
  async open(name, options) {}   // returns MyConnection
  async destroy(name) {}
}
```

Range objects use this format (adapter translates to native):
```javascript
{ lower: value, lowerOpen: boolean, upper: value, upperOpen: boolean }
```

## Design Principles

Before contributing, please read [DESIGN.md](./DESIGN.md). The key principles:

- **Async iterables as the base primitive** — all iteration uses `for await...of`
- **Pull semantics** — cursors advance only when the consumer asks
- **Fast paths** — use the storage engine when possible, JS fallback when not
- **Immutable query builder** — every modifier returns a clone
- **Adapters are thin** — the core does the heavy lifting, adapters just translate

## Areas Where Help Is Wanted

- **New adapters** — Turso, PlanetScale, KV, Redis, localStorage
- **Framework integrations** — React hooks, Vue composables, Svelte stores
- **Performance** — profiling, optimization, benchmark comparisons
- **Documentation** — examples, guides, tutorials
- **TypeScript** — generic schema types, stricter typing

## Code of Conduct

Be kind. Be constructive. Assume good intent.
