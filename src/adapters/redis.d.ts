import type { Adapter, AdapterConnection, OpenOptions } from '../easydb.js';

/** Redis adapter via ioredis or @upstash/redis. */
export declare class RedisAdapter implements Adapter {
  constructor(redis: any, opts?: { prefix?: string });
  open(name: string, options?: OpenOptions): Promise<AdapterConnection>;
  destroy(name: string): Promise<void>;
}
