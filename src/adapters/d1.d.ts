import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** Cloudflare D1 (SQLite) adapter for Workers. */
export declare class D1Adapter implements Adapter {
  constructor(d1: any);
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
