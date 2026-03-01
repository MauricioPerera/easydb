import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** MongoDB adapter via the official mongodb driver. */
export declare class MongoAdapter implements Adapter {
  constructor(dbOrClient: any, opts?: { prefix?: string; dbName?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
