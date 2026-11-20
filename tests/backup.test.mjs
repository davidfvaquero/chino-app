import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, memoryDriver } from '../src/storage.js';
import { exportAll, validate, importAll } from '../src/backup.js';
import { dateStamp, describeExport } from '../src/extras/backup.js';
import { createDeck } from '../src/srs.js';
import { createGamification, dayIndex, EVENTS } from '../src/gamification.js';

/** Fresh storage + deck + gamification for each test. */
function setup() {
  const storage = createStorage(memoryDriver());
  const deck = createDeck(storage);
  const gamification = createGamification({ storage, now: () => Date.now() });
  return { storage, deck, gamification };
}

test('exportAll: returns correct structure with all stores', async () => {
  const { storage } = setup();
  // Put some data in each store
  await storage.set('meta', 'installDate', 12345);
  await storage.set('settings', 'theme', 'dark');
  await storage.set('srs', 'card1', { id: 'card1', hanzi: '你好', due: 0 });
  await storage.set('progress', 'lesson1', { done: true });
  await storage.set('gamification', 'state', { points: 100, streak: 5 });

  const exported = await exportAll(storage);

  assert.equal(exported.app, 'chino-app');
  assert.equal(exported.version, 1);
  assert.ok(typeof exported.exportedAt === 'number' && exported.exportedAt > 0);
  assert.ok(exported.stores);
  assert.equal(Object.keys(exported.stores.meta).length, 1);
  assert.equal(exported.stores.meta.installDate, 12345);
  assert.equal(exported.stores.settings.theme, 'dark');
  assert.equal(Object.keys(exported.stores.srs).length, 1);
  assert.equal(exported.stores.progress.lesson1.done, true);
  assert.equal(exported.stores.gamification.state.points, 100);
});

test('exportAll: empty stores produce empty objects', async () => {
  const { storage } = setup();
  const exported = await exportAll(storage);
  for (const store of ['meta', 'settings', 'srs', 'progress', 'gamification']) {
    assert.deepEqual(exported.stores[store], {});
  }
});

test('validate: accepts a valid export object', () => {
  const valid = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: {},
      settings: {},
      srs: {},
      progress: {},
      gamification: {},
    },
  };
  assert.deepEqual(validate(valid), { ok: true });
});

test('validate: rejects wrong app name', () => {
  const obj = { app: 'other-app', version: 1, exportedAt: Date.now(), stores: {} };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.wrongApp' });
});

test('validate: rejects unknown version', () => {
  const obj = { app: 'chino-app', version: 2, exportedAt: Date.now(), stores: {} };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.unknownVersion' });
});

test('validate: rejects missing stores', () => {
  const obj = { app: 'chino-app', version: 1, exportedAt: Date.now() };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.missingStores' });
});

test('validate: rejects unknown store key', () => {
  const obj = { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: { unknown: {} } };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.unknownStore' });
});

test('validate: rejects non-object store value', () => {
  const obj = { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: { meta: 'not-object' } };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.storeNotObject' });
});

test('validate: rejects non-serializable values (function)', () => {
  const obj = { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: { meta: { key: () => {} } } };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.nonSerializableValue' });
});

test('validate: rejects non-serializable values (circular)', () => {
  const circular = {};
  circular.self = circular;
  const obj = { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: { meta: { key: circular } } };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.nonSerializableValue' });
});

test('validate: rejects BigInt', () => {
  const obj = { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: { meta: { key: 1n } } };
  assert.deepEqual(validate(obj), { ok: false, error: 'export.nonSerializableValue' });
});

test('importAll: replace mode overwrites all stores', async () => {
  const { storage, deck, gamification } = setup();
  // Seed existing data
  await storage.set('meta', 'old', 'value');
  await storage.set('settings', 'theme', 'light');
  await deck.addToReview({ hanzi: '旧', pinyin: 'jiu', english: ['old'] });
  await storage.set('progress', 'old', { done: false });
  await gamification.record('review_done');

  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: { new: 'meta' },
      settings: { theme: 'dark', fontScale: 1.15 },
      srs: { card1: { id: 'card1', hanzi: '新', pinyin: 'xin', english: ['new'], source: 'dict', addedAt: Date.now(), reviews: 0, ease: 2.5, reps: 0, lapses: 0, interval: 0, due: Date.now(), lastReviewed: null, lastRating: null } },
      progress: { lesson1: { done: true } },
      gamification: { state: { points: 500, streak: 10, bestStreak: 10, lastDay: dayIndex(), days: { [dayIndex()]: 1 }, events: { review_done: 50 }, achievements: {} } },
    },
  };

  const result = await importAll(exportData, { mode: 'replace' }, storage);
  assert.ok(result.imported > 0);

  // Verify all stores replaced
  assert.equal((await storage.get('meta', 'new')), 'meta');
  assert.equal((await storage.get('meta', 'old')), undefined);
  assert.equal((await storage.get('settings', 'theme')), 'dark');
  assert.equal((await storage.get('settings', 'fontScale')), 1.15);
  const cards = await deck.listCards();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].hanzi, '新');
  assert.equal((await storage.get('progress', 'lesson1')).done, true);
  assert.equal((await storage.get('progress', 'old')), undefined);
  const stats = await gamification.getStats();
  assert.equal(stats.points, 500);
  assert.equal(stats.streak, 10);
});

test('importAll: merge mode keeps newer SRS cards by lastReviewed', async () => {
  const { storage, deck } = setup();
  const now = Date.now();

  // Existing card reviewed recently
  await storage.set('srs', 'existing', { id: 'existing', hanzi: '共', pinyin: 'gong', english: ['shared'], lastReviewed: now, addedAt: now - 100000 });

  // Import has older card
  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: {},
      settings: {},
      srs: { existing: { id: 'existing', hanzi: '共', pinyin: 'gong', english: ['shared'], lastReviewed: now - 200000, addedAt: now - 300000 } },
      progress: {},
      gamification: {},
    },
  };

  await importAll(exportData, { mode: 'merge' }, storage);

  // Existing (newer) should be kept
  const kept = await storage.get('srs', 'existing');
  assert.equal(kept.lastReviewed, now);
});

test('importAll: merge mode imports newer SRS cards from backup', async () => {
  const { storage, deck } = setup();
  const now = Date.now();

  // Existing card is old
  await storage.set('srs', 'card1', { id: 'card1', hanzi: '老', pinyin: 'lao', english: ['old'], lastReviewed: now - 200000, addedAt: now - 300000 });

  // Import has newer card
  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: {},
      settings: {},
      srs: { card1: { id: 'card1', hanzi: '新', pinyin: 'xin', english: ['new'], lastReviewed: now, addedAt: now - 1000 } },
      progress: {},
      gamification: {},
    },
  };

  await importAll(exportData, { mode: 'merge' }, storage);

  const kept = await storage.get('srs', 'card1');
  assert.equal(kept.hanzi, '新');
  assert.equal(kept.lastReviewed, now);
});

test('importAll: merge mode keeps local keys not in backup', async () => {
  const { storage } = setup();
  await storage.set('settings', 'localOnly', 'keepme');

  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: {},
      settings: { theme: 'dark' },
      srs: {},
      progress: {},
      gamification: {},
    },
  };

  await importAll(exportData, { mode: 'merge' }, storage);

  assert.equal((await storage.get('settings', 'localOnly')), 'keepme');
  assert.equal((await storage.get('settings', 'theme')), 'dark');
});

test('importAll: replace mode removes local keys not in backup', async () => {
  const { storage } = setup();
  await storage.set('settings', 'localOnly', 'keepme');

  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: {},
      settings: { theme: 'dark' },
      srs: {},
      progress: {},
      gamification: {},
    },
  };

  await importAll(exportData, { mode: 'replace' }, storage);

  assert.equal((await storage.get('settings', 'localOnly')), undefined);
  assert.equal((await storage.get('settings', 'theme')), 'dark');
});

test('importAll: rejects invalid export without writing', async () => {
  const { storage } = setup();
  await storage.set('meta', 'original', 'value');

  const badExport = { app: 'wrong-app', version: 1, exportedAt: Date.now(), stores: {} };

  await assert.rejects(() => importAll(badExport, { mode: 'replace' }, storage), /export.wrongApp/);

  // Original data should be untouched
  assert.equal((await storage.get('meta', 'original')), 'value');
});

test('importAll: rejects corrupt JSON structure without writing', async () => {
  const { storage } = setup();
  await storage.set('meta', 'original', 'value');

  const badExport = { app: 'chino-app', version: 999, exportedAt: Date.now(), stores: {} };

  await assert.rejects(() => importAll(badExport, { mode: 'replace' }, storage), /export.unknownVersion/);

  assert.equal((await storage.get('meta', 'original')), 'value');
});

test('round-trip: export -> import (replace) preserves all data', async () => {
  const { storage, deck, gamification } = setup();

  // Add realistic data
  await storage.set('meta', 'installDate', 1000);
  await storage.set('settings', 'theme', 'dark');
  await storage.set('settings', 'fontScale', 1.15);
  await deck.addToReview({ id: 123, hanzi: '你好', pinyin: 'nǐ hǎo', pinyinNumeric: 'ni3 hao3', english: ['hello'], source: 'dict' });
  await deck.addToReview({ id: 456, hanzi: '谢谢', pinyin: 'xiè xie', pinyinNumeric: 'xie4 xie4', english: ['thank you'], source: 'lesson' });
  await storage.set('progress', 'lesson-01', { done: true, score: 90 });
  await gamification.record('review_done');
  await gamification.record('lesson_done');
  await gamification.record('stroke_done');

  // Export
  const exported = await exportAll(storage);

  // Clear storage (simulate fresh browser)
  for (const store of ['meta', 'settings', 'srs', 'progress', 'gamification']) {
    const entries = await storage.list(store);
    for (const { key } of entries) {
      await storage.remove(store, key);
    }
  }

  // Import
  await importAll(exported, { mode: 'replace' }, storage);

  // Verify everything restored
  assert.equal((await storage.get('meta', 'installDate')), 1000);
  assert.equal((await storage.get('settings', 'theme')), 'dark');
  assert.equal((await storage.get('settings', 'fontScale')), 1.15);
  const cards = await deck.listCards();
  assert.equal(cards.length, 2);
  const progress = await storage.get('progress', 'lesson-01');
  assert.equal(progress.done, true);
  assert.equal(progress.score, 90);
  const stats = await gamification.getStats();
  assert.equal(stats.points, EVENTS.review_done + EVENTS.lesson_done + EVENTS.stroke_done);
  assert.equal(stats.streak, 1);
});

test('round-trip: export -> import (merge) preserves local newer data', async () => {
  const { storage, deck } = setup();

  // Local data: one card reviewed today
  await deck.addToReview({ id: 1, hanzi: '本地', pinyin: 'ben di', english: ['local'], source: 'dict' });
  const localCard = await storage.get('srs', 'd1');
  await storage.set('srs', 'd1', { ...localCard, lastReviewed: Date.now() });

  // Export current state
  const exported = await exportAll(storage);

  // Simulate: user reviews another card locally (newer)
  await deck.addToReview({ id: 2, hanzi: '更新', pinyin: 'geng xin', english: ['newer'], source: 'dict' });
  const newerCard = await storage.get('srs', 'd2');
  await storage.set('srs', 'd2', { ...newerCard, lastReviewed: Date.now() + 1000 });

  // Now import the old export with merge
  await importAll(exported, { mode: 'merge' }, storage);

  // Local newer card (d2) should be kept
  const d2 = await storage.get('srs', 'd2');
  assert.equal(d2.hanzi, '更新');

  // Card from backup (d1) should be restored (it was deleted locally before import? No, merge keeps both)
  // Actually merge: union of keys. d1 exists in both, backup has older lastReviewed, local has newer -> keep local
  // d2 only in local -> keep local
  // So both should exist
  const cards = await deck.listCards();
  assert.equal(cards.length, 2);
});

test('headless: export, delete a card, import and recover it', async () => {
  const { storage, deck } = setup();

  // Add a card
  await deck.addToReview({ id: 999, hanzi: '测试', pinyin: 'ce shi', english: ['test'], source: 'dict' });
  let cards = await deck.listCards();
  assert.equal(cards.length, 1);

  // Export
  const exported = await exportAll(storage);

  // Delete the card
  await storage.remove('srs', 'd999');
  cards = await deck.listCards();
  assert.equal(cards.length, 0);

  // Import (replace mode)
  await importAll(exported, { mode: 'replace' }, storage);

  // Card recovered
  cards = await deck.listCards();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].hanzi, '测试');
});

test('importAll: returned counts reflect imported and skipped', async () => {
  const { storage } = setup();
  await storage.set('srs', 'existing', { id: 'existing', hanzi: '旧', lastReviewed: Date.now() });

  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: {},
      settings: {},
      srs: {
        existing: { id: 'existing', hanzi: '旧', lastReviewed: Date.now() - 10000 }, // older
        new: { id: 'new', hanzi: '新', lastReviewed: Date.now() }, // new
      },
      progress: {},
      gamification: {},
    },
  };

  const result = await importAll(exportData, { mode: 'merge' }, storage);
  // 'existing' is skipped (local newer), 'new' is imported
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
});

test('importAll: rolls back every write when one fails midway', async () => {
  // A driver that throws on the 2nd write (first is the removal of the old key).
  const base = memoryDriver();
  let writes = 0;
  let armed = false;
  const flaky = {
    name: 'flaky',
    ...base,
    get: base.get,
    list: base.list,
    async set(store, key, value) {
      if (armed && ++writes === 2) throw new Error('disk on fire');
      return base.set(store, key, value);
    },
    async remove(store, key) {
      if (armed && ++writes === 2) throw new Error('disk on fire');
      return base.remove(store, key);
    },
  };
  const storage = createStorage(flaky);
  await storage.set('meta', 'installDate', 1000);
  await storage.set('settings', 'theme', 'light');
  armed = true;

  const exportData = {
    app: 'chino-app',
    version: 1,
    exportedAt: Date.now(),
    stores: {
      meta: { other: 'x', another: 'y' },
      settings: { theme: 'dark' },
      srs: {},
      progress: {},
      gamification: {},
    },
  };

  await assert.rejects(() => importAll(exportData, { mode: 'replace' }, storage), /disk on fire/);

  // Nothing changed: the removal that had already happened was undone.
  assert.equal(await storage.get('meta', 'installDate'), 1000);
  assert.equal(await storage.get('meta', 'other'), undefined);
  assert.equal(await storage.get('meta', 'another'), undefined);
  assert.equal(await storage.get('settings', 'theme'), 'light');
});

test('importAll: rejects a bad mode without touching storage', async () => {
  const { storage } = setup();
  await storage.set('meta', 'x', 1);
  const exported = await exportAll(storage);
  await assert.rejects(() => importAll(exported, { mode: 'nonsense' }, storage), /import.badMode/);
  assert.equal(await storage.get('meta', 'x'), 1);
});

test('validate: rejects an array, a store that is an array, and a missing stores map', () => {
  const ok = { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: {} };
  assert.equal(validate([]).error, 'export.invalidType');
  assert.equal(validate({ ...ok, stores: [] }).error, 'export.missingStores');
  assert.equal(validate({ ...ok, stores: { meta: [] } }).error, 'export.storeNotObject');
  assert.equal(validate({ ...ok, exportedAt: 0 }).error, 'export.badTimestamp');
  assert.equal(validate({ ...ok, stores: { srs: { a: 1 }, extra: {} } }).error, 'export.unknownStore');
});

test('dateStamp: local YYYY-MM-DD', () => {
  const stamp = dateStamp(new Date(2026, 0, 5).getTime());
  assert.equal(stamp, '2026-01-05');
});

test('describeExport: counts cards, streak, lessons and points from a file', () => {
  const data = {
    stores: {
      srs: { d1: {}, d2: {}, d3: {} },
      gamification: { state: { streak: 4, points: 250, events: { lesson_done: 7 } } },
    },
  };
  assert.deepEqual(describeExport(data), { cards: 3, streak: 4, lessons: 7, points: 250 });
  assert.deepEqual(describeExport(null), { cards: 0, streak: 0, lessons: 0, points: 0 });
});