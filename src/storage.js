/**
 * storage.js — the ONLY module allowed to touch IndexedDB or localStorage.
 * Everything else in the app goes through this async API (per "store" namespace).
 *
 *   await storage.get(store, key)          -> value | undefined
 *   await storage.set(store, key, value)   -> value
 *   await storage.remove(store, key)       -> boolean (true if it existed)
 *   await storage.delete(store, key)       -> alias of remove (kept for API parity)
 *   await storage.list(store)              -> [{ key, value }, ...]
 *   await storage.name()                   -> 'indexeddb' | 'localstorage' | 'memory'
 *
 * Drivers, tried in this order: IndexedDB -> localStorage -> in-memory (Node/tests).
 *
 * EXTENSION POINT (sync / login, phase 5): implement a new driver with the same
 * four methods (get/set/remove/list) that also talks to a server (or wraps the
 * IndexedDB driver and pushes changes), then swap it in via createStorage(driver)
 * or pickDriver(). Nothing outside this file changes.
 */

export const DB_NAME = 'chino-app';
export const DB_VERSION = 1;
/** Object stores created on first open. Add new ones here (needs a version bump). */
export const STORES = ['meta', 'settings', 'srs', 'progress', 'gamification'];
const LS_PREFIX = 'chino:';

/** In-memory driver: fallback for Node/tests and for browsers without any storage. */
export function memoryDriver() {
  const data = new Map(); // store -> Map(key -> value)
  const bucket = (store) => {
    if (!data.has(store)) data.set(store, new Map());
    return data.get(store);
  };
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  return {
    name: 'memory',
    async get(store, key) {
      return clone(bucket(store).get(key));
    },
    async set(store, key, value) {
      bucket(store).set(key, clone(value));
      return value;
    },
    async remove(store, key) {
      return bucket(store).delete(key);
    },
    async list(store) {
      return [...bucket(store)].map(([key, value]) => ({ key, value: clone(value) }));
    },
  };
}

/** localStorage driver: JSON strings under `chino:<store>:<key>`. */
export function localStorageDriver(ls = globalThis.localStorage) {
  const full = (store, key) => `${LS_PREFIX}${store}:${key}`;
  const storeOf = (fullKey) => fullKey.slice(LS_PREFIX.length).split(':')[0];
  const keysOf = (store) => {
    const out = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && k.startsWith(`${LS_PREFIX}${store}:`)) out.push(k);
    }
    return out;
  };
  return {
    name: 'localstorage',
    async get(store, key) {
      const raw = ls.getItem(full(store, key));
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(store, key, value) {
      ls.setItem(full(store, key), JSON.stringify(value ?? null));
      return value;
    },
    async remove(store, key) {
      const k = full(store, key);
      const existed = ls.getItem(k) !== null;
      ls.removeItem(k);
      return existed;
    },
    async list(store) {
      const out = [];
      for (const k of keysOf(store)) {
        try {
          out.push({ key: k.slice(`${LS_PREFIX}${store}:`.length), value: JSON.parse(ls.getItem(k)) });
        } catch {
          /* ignore unparsable entries */
        }
      }
      return out;
    },
    _storeOf: storeOf,
  };
}

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    req.onblocked = () => reject(new Error('indexedDB.open blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/** IndexedDB driver: values are stored as structured-cloned objects. */
export function idbDriver() {
  const withStore = async (store, mode, fn) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve(undefined);
      }
    });
  };
  return {
    name: 'indexeddb',
    get: (store, key) => withStore(store, 'readonly', (os) => os.get(key)),
    set: (store, key, value) =>
      withStore(store, 'readwrite', (os) => os.put(value, key)).then(() => value),
    async remove(store, key) {
      const existed = (await withStore(store, 'readonly', (os) => os.count(key))) > 0;
      await withStore(store, 'readwrite', (os) => os.delete(key));
      return existed;
    },
    list: (store) =>
      withStore(store, 'readonly', (os) => os.getAllKeys()).then(async (keys) => {
        const out = [];
        for (const key of keys) out.push({ key, value: await withStore(store, 'readonly', (os) => os.get(key)) });
        return out;
      }),
  };
}

/** Driver chosen lazily on first use; never throws, degrades instead. */
export function lazyDriver(pick = pickDriver) {
  let resolved = null;
  const get = async () => {
    if (!resolved) resolved = await pick();
    return resolved;
  };
  return {
    name: 'lazy',
    async get(store, key) {
      return (await get()).get(store, key);
    },
    async set(store, key, value) {
      return (await get()).set(store, key, value);
    },
    async remove(store, key) {
      return (await get()).remove(store, key);
    },
    async list(store) {
      return (await get()).list(store);
    },
    resolveName: async () => (await get()).name,
  };
}

export async function pickDriver() {
  if (globalThis.indexedDB) {
    try {
      await openDb();
      return idbDriver();
    } catch (err) {
      console.warn('storage: IndexedDB unavailable, falling back', err);
    }
  }
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = `${LS_PREFIX}__probe__`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return localStorageDriver(ls);
    }
  } catch {
    /* private mode / disabled storage -> memory */
  }
  return memoryDriver();
}

/** Wraps a driver into the public API (validating the store name). */
export function createStorage(driver) {
  const check = (store) => {
    if (typeof store !== 'string' || !store) throw new TypeError('store name required');
    return store;
  };
  // Every method is async, so bad arguments surface as rejected promises
  // (callers should not need try/catch around the call itself).
  return {
    get: async (store, key) => driver.get(check(store), String(key)),
    set: async (store, key, value) => driver.set(check(store), String(key), value),
    remove: async (store, key) => driver.remove(check(store), String(key)),
    /** Alias kept so callers can use the name stated in the task API. */
    delete: async (store, key) => driver.remove(check(store), String(key)),
    list: async (store) => driver.list(check(store)),
    name: async () => (driver.resolveName ? driver.resolveName() : driver.name),
    _driver: driver,
  };
}

/**
 * Optional sync/login hook (phase 5): register a callback invoked after every
 * successful local write, so a future remote layer can mirror changes.
 */
const writeHooks = new Set();
export function onWrite(fn) {
  writeHooks.add(fn);
  return () => writeHooks.delete(fn);
}

const store = createStorage(lazyDriver());
const wrapped = {
  ...store,
  async set(st, key, value) {
    const out = await store.set(st, key, value);
    for (const fn of writeHooks) {
      try {
        await fn({ store: st, key: String(key), value });
      } catch (err) {
        console.warn('storage: write hook failed', err);
      }
    }
    return out;
  },
};

export default wrapped;
