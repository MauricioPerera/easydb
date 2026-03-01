import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** IndexedDB adapter (browser). Default when no adapter is specified. */
export declare class IDBAdapter implements Adapter {
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
