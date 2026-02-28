/**
 * Mock Cloudflare KV namespace for testing.
 * Implements the KVNamespace interface: get, put, delete, list.
 */
export class MockKV {
  constructor() {
    this._store = new Map();
  }

  async get(key, type) {
    const val = this._store.get(key);
    if (val === undefined) return null;
    if (type === 'json') return JSON.parse(val);
    return val;
  }

  async put(key, value) {
    this._store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  async delete(key) {
    this._store.delete(key);
  }

  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    const allKeys = Array.from(this._store.keys())
      .filter(k => k.startsWith(prefix))
      .sort();

    let start = 0;
    if (cursor) {
      start = parseInt(cursor, 10);
    }

    const slice = allKeys.slice(start, start + limit);
    const nextStart = start + limit;
    const list_complete = nextStart >= allKeys.length;

    return {
      keys: slice.map(name => ({ name })),
      list_complete,
      cursor: list_complete ? undefined : String(nextStart),
    };
  }
}
