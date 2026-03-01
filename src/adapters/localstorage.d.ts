import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** localStorage adapter for simple browser persistence. */
export declare class LocalStorageAdapter implements Adapter {
  constructor(opts?: { prefix?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
