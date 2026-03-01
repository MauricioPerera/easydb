import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** MySQL / MariaDB adapter via mysql2/promise. */
export declare class MySQLAdapter implements Adapter {
  constructor(client: any, opts?: {});
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
