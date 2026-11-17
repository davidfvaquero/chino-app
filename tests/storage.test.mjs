import { test } from 'node:test';
import assert from 'node:assert/strict';
import storage, {
  createStorage,
  localStorageDriver,
  memoryDriver,
  onWrite,
  pickDriver,
  STORES,
} from '../src/storage.js';

/** Minimal localStorage stand-in (Node has none). */
function fakeLocalStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

test('memory driver: get/set/delete/list round-trip', async () => {
  const db = createStorage(memoryDriver());
  assert.equal(await db.get('srs', 'missing'), undefined);
  assert.deepEqual(await db.set('srs', '你好', { reps: 2 }), { reps: 2 });
  assert.deepEqual(await db.get('srs', '你好'), { reps: 2 });
  assert.deepEqual(await db.list('srs'), [{ key: '你好', value: { reps: 2 } }]);
});

test('delete removes the entry and reports whether it existed', async () => {
  const db = createStorage(memoryDriver());
  await db.set('progress', 'hsk1', { done: false });
  assert.equal(await db.remove('progress', 'hsk1'), true);
  assert.equal(await db.remove('progress', 'hsk1'), false);
  assert.equal(await db.get('progress', 'hsk1'), undefined);
  assert.deepEqual(await db.list('progress'), []);
});

test('the delete alias behaves like remove', async () => {
  const db = createStorage(memoryDriver());
  await db.set('meta', 'k', 1);
  assert.equal(await db.delete('meta', 'k'), true);
  assert.equal(await db.get('meta', 'k'), undefined);
});

test('stores are isolated from each other', async () => {
  const db = createStorage(memoryDriver());
  await db.set('srs', 'shared', 'srs-value');
  await db.set('progress', 'shared', 'progress-value');
  assert.equal(await db.get('srs', 'shared'), 'srs-value');
  assert.equal(await db.get('progress', 'shared'), 'progress-value');
  assert.deepEqual(await db.list('meta'), []);
});

test('list returns every entry of one store', async () => {
  const db = createStorage(memoryDriver());
  await db.set('gamification', 'points', 10);
  await db.set('gamification', 'streak', 4);
  const entries = (await db.list('gamification')).sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(entries, [
    { key: 'points', value: 10 },
    { key: 'streak', value: 4 },
  ]);
});

test('values are copied, not shared by reference', async () => {
  const db = createStorage(memoryDriver());
  const card = { front: '你好', reps: 0 };
  await db.set('srs', 'card', card);
  card.reps = 99; // mutating the caller's object must not change the stored one
  assert.deepEqual(await db.get('srs', 'card'), { front: '你好', reps: 0 });
});

test('store names are required', async () => {
  const db = createStorage(memoryDriver());
  await assert.rejects(() => db.get('', 'k'), TypeError);
});

test('localStorage driver: same API over JSON strings', async () => {
  const ls = fakeLocalStorage();
  const db = createStorage(localStorageDriver(ls));
  await db.set('settings', 'locale', 'es');
  assert.equal(ls.getItem('chino:settings:locale'), '"es"');
  assert.equal(await db.get('settings', 'locale'), 'es');
  assert.deepEqual(await db.list('settings'), [{ key: 'locale', value: 'es' }]);
  assert.equal(await db.remove('settings', 'locale'), true);
  assert.equal(await db.get('settings', 'locale'), undefined);
  assert.deepEqual(await db.list('settings'), []);
});

test('localStorage driver ignores unparsable data instead of throwing', async () => {
  const ls = fakeLocalStorage({ 'chino:meta:junk': '{not json' });
  const db = createStorage(localStorageDriver(ls));
  assert.equal(await db.get('meta', 'junk'), undefined);
  assert.deepEqual(await db.list('meta'), []);
});

test('pickDriver() degrades to memory when no browser storage exists', async () => {
  const driver = await pickDriver();
  assert.equal(driver.name, 'memory');
});

test('the default export is ready to use in Node (memory fallback)', async () => {
  assert.equal(await storage.name(), 'memory');
  await storage.set('meta', 'boot', { at: 1 });
  assert.deepEqual(await storage.get('meta', 'boot'), { at: 1 });
  assert.equal(await storage.delete('meta', 'boot'), true);
});

test('onWrite hooks fire after a successful write (extension point for sync)', async () => {
  const seen = [];
  const off = onWrite((change) => seen.push(change));
  await storage.set('progress', 'hook-test', 7);
  off();
  await storage.set('progress', 'after-off', 8);
  assert.deepEqual(seen, [{ store: 'progress', key: 'hook-test', value: 7 }]);
});

test('STORES lists the object stores created on first open', () => {
  assert.deepEqual(STORES, ['meta', 'settings', 'srs', 'progress', 'gamification']);
});
