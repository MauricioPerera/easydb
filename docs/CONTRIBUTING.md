# Contributing to EasyDB

Thanks for your interest in contributing! EasyDB is a small, focused project and we welcome contributions that align with its philosophy.

## Philosophy

- **Minimal** — no dependencies, small surface area
- **Modern** — ES2018+, async/await, async iterables
- **Multi-backend** — same API across IndexedDB, Memory, D1, KV

## Getting Started

```bash
git clone https://github.com/MauricioPerera/easydb.git
cd easydb
npm install
npm test
```

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add/update tests for your changes
4. Run the full test suite: `npm test`
5. Run the build: `npm run build`
6. Submit a pull request

## Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

All tests must pass before submitting a PR.

## Project Structure

```
src/
  easydb.js           # Core API (~400 LOC)
  easydb.d.ts         # TypeScript declarations
  sync.js             # SyncEngine — cross-adapter replication
  sync.d.ts           # SyncEngine type declarations
  adapters/
    indexeddb.js       # Browser IndexedDB adapter
    memory.js          # In-memory adapter (testing/SSR)
    d1.js              # Cloudflare D1/SQLite adapter
    kv.js              # Cloudflare KV adapter
    sqlite.js          # SQLite adapter (better-sqlite3)
    postgres.js        # PostgreSQL adapter (node-postgres/Neon)
    redis.js           # Redis adapter (ioredis/Upstash)
    turso.js           # Turso/libSQL adapter
    localstorage.js    # localStorage adapter (browser)
  react.js             # React hooks
  vue.js               # Vue composables
  svelte.js            # Svelte stores
  angular.js           # Angular signals
  solid.js             # SolidJS signals
  preact.js            # Preact hooks
  lit.js               # Lit reactive controller
tests/                 # Vitest test files
examples/              # Usage examples
scripts/
  build.js             # CDN build script (esbuild)
```

## Writing an Adapter

The adapter interface is intentionally minimal. See `src/adapters/memory.js` for a complete reference implementation (~290 LOC).

An adapter must implement:

```javascript
class MyAdapter {
  async open(name, options) {
    // Return an AdapterConnection with:
    // name, version, storeNames, hasStore(), getKeyPath(), close(),
    // get(), getAll(), count(), getMany(),
    // put(), delete(), clear(), putMany(),
    // cursor() (async generator), transaction()
  }
  async destroy(name) { /* delete the database */ }
}
```

## Code Style

- No semi-colons enforcement — match the existing file style
- Prefer `const` over `let`; never use `var`
- Use descriptive names; avoid single-letter variables outside loops
- Keep functions short and focused
- JSDoc comments for public API methods

## What We're Looking For

- Bug fixes with regression tests
- Performance improvements with benchmarks
- Documentation improvements
- New framework integrations

## What We're NOT Looking For

- Breaking changes to the public API (we're targeting a 1.0 freeze)
- Dependencies (keep it zero-dep)
- ORM features (relations, schema validation, etc.)
- SQL support in the query builder
- Legacy browser support (IE, old Edge)

## Bundle Size Budget

The core ESM bundle (core + IDB adapter) must stay under **5KB gzipped**. Run `npm run build` to check sizes before submitting.

## Reporting Bugs

Open an issue at [github.com/MauricioPerera/easydb/issues](https://github.com/MauricioPerera/easydb/issues) with:

1. EasyDB version
2. Adapter used (IDB, Memory, D1, KV, SQLite, PostgreSQL, Redis, Turso, localStorage)
3. Browser/runtime and version
4. Minimal reproduction code
5. Expected vs. actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
