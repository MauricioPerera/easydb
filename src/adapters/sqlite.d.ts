import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** SQLite adapter via better-sqlite3. File-based or in-memory. */
export declare class SQLiteAdapter implements Adapter {
  constructor(filename: string, opts?: Record<string, any>);
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
