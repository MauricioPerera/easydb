import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** PostgreSQL adapter via node-postgres or Neon serverless. */
export declare class PostgresAdapter implements Adapter {
  constructor(client: any, opts?: { schema?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
