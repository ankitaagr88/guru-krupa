/* In-memory stand-in for the `idb` package used by src/offline/captureQueue.js.
   Tests do: vi.mock('idb', () => import('../test/fakeIdb')); and set
   `globalThis.indexedDB = {}` so hasIndexedDB() is true in jsdom. */
const dbs = new Map();

class FakeDB {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: (n) => this.stores.has(n) };
  }
  createObjectStore(name, { keyPath }) {
    this.stores.set(name, { keyPath, rows: new Map() });
    return { createIndex() {} };
  }
  _s(name) {
    if (!this.stores.has(name)) throw new Error(`No store ${name}`);
    return this.stores.get(name);
  }
  async put(name, rec) {
    const s = this._s(name);
    s.rows.set(rec[s.keyPath], rec);
    return rec[s.keyPath];
  }
  async get(name, key) {
    return this._s(name).rows.get(key);
  }
  async getAll(name) {
    return Array.from(this._s(name).rows.values());
  }
  async count(name) {
    return this._s(name).rows.size;
  }
  async delete(name, key) {
    this._s(name).rows.delete(key);
  }
  async clear(name) {
    this._s(name).rows.clear();
  }
}

export async function openDB(name, version, { upgrade } = {}) {
  if (!dbs.has(name)) {
    const db = new FakeDB();
    upgrade?.(db);
    dbs.set(name, db);
  }
  return dbs.get(name);
}

export function resetFakeIdb() {
  dbs.clear();
}
