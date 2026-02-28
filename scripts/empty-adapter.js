// Stub for server-only adapters excluded from browser CDN bundles
export class D1Adapter { constructor() { throw new Error('D1Adapter is not available in browser builds. Import @rckflr/easydb/adapters/d1 directly.'); } }
export class KVAdapter { constructor() { throw new Error('KVAdapter is not available in browser builds. Import @rckflr/easydb/adapters/kv directly.'); } }
