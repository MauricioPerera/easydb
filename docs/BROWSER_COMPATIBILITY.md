# Browser Compatibility

EasyDB targets **ES2018+** and requires `async/await`, async iterables (`for await...of`), and `Proxy`. No transpilation or polyfills needed in any modern browser.

## Minimum Versions

| Browser | Minimum Version | Release Date |
|---------|----------------|--------------|
| Chrome | 63+ | Dec 2017 |
| Firefox | 57+ | Nov 2017 |
| Safari | 12+ | Sep 2018 |
| Edge | 79+ (Chromium) | Jan 2020 |
| Opera | 50+ | Jan 2018 |
| Samsung Internet | 8.0+ | Dec 2018 |
| iOS Safari | 12+ | Sep 2018 |
| Chrome Android | 63+ | Dec 2017 |

## Runtime Support

| Runtime | Support | Notes |
|---------|---------|-------|
| Node.js | 18+ | MemoryAdapter or D1Adapter only (no IndexedDB) |
| Deno | 1.0+ | MemoryAdapter; IndexedDB via polyfill |
| Bun | 1.0+ | MemoryAdapter; IndexedDB via polyfill |
| Cloudflare Workers | Yes | D1Adapter or KVAdapter |

## Feature Requirements by Adapter

### IDBAdapter (Browser)

| Feature | Required | Fallback |
|---------|----------|----------|
| IndexedDB | Yes | None (core requirement) |
| `structuredClone` | No | Uses IDB's built-in cloning |
| BroadcastChannel | No | Watch works locally, no cross-tab sync |

### MemoryAdapter

No platform-specific requirements. Works anywhere ES2018 runs.

### D1Adapter (Cloudflare Workers)

Requires the Cloudflare Workers runtime with D1 bindings.

### KVAdapter (Cloudflare Workers)

Requires the Cloudflare Workers runtime with KV namespace bindings.

## CDN Usage

For environments without a bundler, use the pre-built CDN bundles:

```html
<!-- ESM (recommended) -->
<script type="module">
  import { EasyDB, IDBAdapter } from './dist/easydb.mjs.js';
</script>

<!-- IIFE (global variable) -->
<script src="./dist/easydb.iife.js"></script>
<script>
  const { EasyDB, IDBAdapter } = window.EasyDB;
</script>

<!-- UMD (AMD/CommonJS/global) -->
<script src="./dist/easydb.umd.js"></script>
```

## Not Supported

- Internet Explorer (any version)
- Opera Mini
- UC Browser < 12.12
- Any browser without `Proxy` and `async/await` support
