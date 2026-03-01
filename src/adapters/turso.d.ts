import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** Turso/libSQL adapter via @libsql/client. */
export declare class TursoAdapter implements Adapter {
  constructor(client: any);
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
