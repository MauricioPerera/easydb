// Stub for server-only adapters excluded from browser CDN bundles
export class D1Adapter { constructor() { throw new Error('D1Adapter is not available in browser builds. Import @rckflr/easydb/adapters/d1 directly.'); } }
export class KVAdapter { constructor() { throw new Error('KVAdapter is not available in browser builds. Import @rckflr/easydb/adapters/kv directly.'); } }
export class PostgresAdapter { constructor() { throw new Error('PostgresAdapter is not available in browser builds. Import @rckflr/easydb/adapters/postgres directly.'); } }
export class RedisAdapter { constructor() { throw new Error('RedisAdapter is not available in browser builds. Import @rckflr/easydb/adapters/redis directly.'); } }
export class TursoAdapter { constructor() { throw new Error('TursoAdapter is not available in browser builds. Import @rckflr/easydb/adapters/turso directly.'); } }
export class SQLiteAdapter { constructor() { throw new Error('SQLiteAdapter is not available in browser builds. Import @rckflr/easydb/adapters/sqlite directly.'); } }
