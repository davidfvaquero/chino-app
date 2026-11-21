/**
 * final-minors-b.test.mjs — tests for the final minors of the B part
 * (docs/REVIEW-6.md M3/M4): Spanish search ranking, the service-worker install
 * retry, prefers-reduced-motion in the stroke sheet, the conversation opener
 * language and the device-local conversation history.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { search, configure, resetCache } from '../src/dictionary.js';
import { createStrokeEngine } from '../src/learn/strokes-svg.js';
import { openerFor } from '../src/chat/prompts.js';
import { memoryDriver, createStorage } from '../src/storage.js';
import { exportAll } from '../src/backup.js';
import { migrateSecrets, isSecret } from '../src/secrets.js';
import { createSync } from '../src/sync/client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

// ---------------------------------------------------------------- M3: search

let calls = 0;
async function fetchData(url) {
  calls += 1;
  const rel = String(url).replace(/^\/data\//, '');
  const file = path.join(DATA, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
before(() => configure({ fetch: fetchData }));
beforeEach(() => { calls = 0; resetCache(); });

const top = (results, n) => results.slice(0, n).map((r) => r.simp);

test('M3: zhong puts 中 in the top 3', async () => {
  const results = await search('zhong', { spanish: true });
  assert.ok(top(results, 3).includes('中'), `zhong -> ${top(results, 8).join(',')}`);
});

test('M3: café ranks the basic word 咖啡 first', async () => {
  const results = await search('café', { spanish: true });
  assert.equal(results[0].simp, '咖啡', `café -> ${top(results, 5).join(',')}`);
});

test('M3: hao puts 好 before 号', async () => {
  const results = await search('hao', { spanish: true });
  assert.equal(results[0].simp, '好', `hao -> ${top(results, 5).join(',')}`);
});

test('M3: agua returns more than four results inside the budget', async () => {
  const results = await search('agua', { spanish: true });
  assert.ok(results.length > 4, `agua -> ${top(results, 8).join(',')}`);
  assert.equal(results[0].simp, '水');
  assert.ok(calls <= 10, `agua: ${calls} requests`);
});

test('M3: an English word does not surface an untranslated fragment first', async () => {
  const hello = await search('hello', { spanish: true });
  assert.notEqual(hello[0]?.simp, '凯蒂猫', `hello -> ${top(hello, 5).join(',')}`);
  const water = await search('water', { spanish: true });
  assert.notEqual(water[0]?.simp, '施耐庵', `water -> ${top(water, 5).join(',')}`);
  // The common word wins for a common English word: the English index only lists
  // the shards that contain it (105 of 115 for "water"), so without ranking them
  // the cap fetched only rare CJK-extension characters.
  assert.equal(water[0]?.simp, '水', `water -> ${top(water, 5).join(',')}`);
  assert.equal((await search('water', { spanish: false }))[0]?.simp, '水');
});

// ------------------------------------------------------- M4: sw install

/** Loads sw.js with a fake caches/fetch; `failFirst` maps a url to how many of
 *  its first adds must fail. */
function makeInstallHarness(failFirst = {}) {
  const src = fs
    .readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
    .replace("const VERSION = 'dev';", "const VERSION = 'test';");
  const listeners = {};
  const remaining = { ...failFirst };
  const added = [];
  const cachesStub = {
    open: async () => ({
      add: async (req) => {
        const url = req.url;
        added.push(url);
        if (remaining[url] > 0) {
          remaining[url] -= 1;
          throw new Error('boom');
        }
      },
      put: async () => {},
    }),
    match: async () => null,
    keys: async () => [],
    delete: async () => true,
  };
  let skipped = false;
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'http://localhost' },
    skipWaiting: async () => { skipped = true; },
    clients: { claim: async () => {} },
  };
  class RequestStub {
    constructor(url) { this.url = String(url); }
  }
  const ResponseStub = { error: () => ({ error: true }) };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', 'Request', src)(
    self, cachesStub, async () => ({ ok: true, status: 200 }), ResponseStub, URL, RequestStub,
  );
  return { listeners, added, skipped: () => skipped };
}

const runInstall = (listeners) => {
  let done = null;
  listeners.install({ waitUntil: (p) => { done = p; } });
  return done;
};

test('M4: the install retries a failed essential once and then succeeds', async () => {
  const { listeners, added } = makeInstallHarness({ './index.html': 1 });
  await runInstall(listeners);
  assert.equal(added.filter((u) => u === './index.html').length, 2, 'the failed add was retried');
});

test('M4: the install fails when an essential cannot be cached', async () => {
  const { listeners } = makeInstallHarness({ './index.html': 99 });
  await assert.rejects(() => runInstall(listeners), /precache failed/);
});

// ---------------------------------------------- M4: reduced-motion sheet

test('M4: the stroke engine paints instantly when prefers-reduced-motion is on', () => {
  const painted = [];
  const engine = createStrokeEngine({ count: 3, reduced: true, paint: (i, p) => painted.push([i, p]) });
  engine.play();
  assert.equal(engine.state(), 'done');
  // Every stroke ends fully drawn, with no timer in between.
  assert.deepEqual(painted.slice(-3), [[0, 1], [1, 1], [2, 1]]);
});

// ------------------------------------------------ M4: opener language

test('M4: the conversation opener carries a translation for every scenario', () => {
  for (const id of ['introductions', 'food', 'directions', 'shopping']) {
    const opener = openerFor(id);
    assert.ok(opener.zh && opener.pinyin && opener.en, `${id} opener`);
    assert.ok(!/[\u3400-\u9fff]/.test(opener.en), `${id} opener translation must not contain hanzi`);
  }
});

test('M4: the opener translations exist in both locales', () => {
  const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
  const en = read('../src/locales/en.d/conversation.json').conversation.opener;
  const es = read('../src/locales/es.d/conversation.json').conversation.opener;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  assert.equal(Object.keys(en).length, 4);
});

// ------------------------------------- M4: conversation history is private

test('M4: migrateSecrets moves settings.conversationHistory to meta', async () => {
  const storage = createStorage(memoryDriver());
  await storage.set('settings', 'conversationHistory', [{ role: 'user', zh: '你好' }]);
  await migrateSecrets(storage);
  assert.equal(await storage.get('settings', 'conversationHistory'), undefined);
  assert.deepEqual(await storage.get('meta', 'conversationHistory'), [{ role: 'user', zh: '你好' }]);
});

test('M4: isSecret covers the conversation history', () => {
  assert.equal(isSecret('meta', 'conversationHistory'), true);
});

test('M4: exportAll never includes the conversation history', async () => {
  const storage = createStorage(memoryDriver());
  await storage.set('meta', 'conversationHistory', [{ role: 'user', zh: '你好' }]);
  await storage.set('settings', 'theme', 'dark');
  const exported = await exportAll(storage);
  assert.equal(exported.stores.meta.conversationHistory, undefined);
  assert.equal(exported.stores.settings.theme, 'dark');
});

test('M4: sync push never uploads the conversation history', async () => {
  const rows = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('/auth/v1/verify')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'T', user: { id: 'u1' } }) };
    }
    if (options.method === 'POST') {
      rows.push(...JSON.parse(options.body));
      return { ok: true, status: 201, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  const storage = createStorage(memoryDriver());
  const sync = createSync({ fetch: fetchImpl, storage, config: { url: 'https://x.test', anonKey: 'k' } });
  await sync.verifyOtp('a@b.c', '1');
  await storage.set('meta', 'conversationHistory', [{ role: 'user', zh: '你好' }]);
  await storage.set('settings', 'theme', 'dark');
  const res = await sync.push();
  assert.equal(res.ok, true);
  assert.equal(rows.some((r) => r.key === 'conversationHistory'), false);
  assert.equal(rows.some((r) => r.store === 'settings' && r.key === 'theme'), true);
});
