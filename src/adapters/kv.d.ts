import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** Cloudflare KV adapter for Workers. */
export declare class KVAdapter implements Adapter {
  constructor(kv: any, opts?: { prefix?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
