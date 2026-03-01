import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** In-memory adapter for testing, SSR, and serverless environments. */
export declare class MemoryAdapter implements Adapter {
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
