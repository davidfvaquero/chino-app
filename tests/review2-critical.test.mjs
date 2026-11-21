/**
 * review2-critical.test.mjs — regression tests for the critical findings of
 * docs/REVIEW-2.md. Each one fails if its fix is reverted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryDriver, createStorage } from '../src/storage.js';
import { exportAll } from '../src/backup.js';
import { migrateSecrets, isSecret } from '../src/secrets.js';
import { cleanGenerated } from '../scripts/lib/clean-data.mjs';
import { createSync } from '../src/sync/client.js';
import { initialModel, nextFreeModel, configuredProviders } from '../src/chat/providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- C4
test('C4: cleanGenerated keeps hand-made data and removes only build outputs', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chino-clean-'));
  const mk = (...parts) => fs.mkdirSync(path.join(out, ...parts), { recursive: true });
  const put = (rel) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), '{}');
  };
  mk('dict', 'shards');
  mk('strokes');
  mk('sentences');
  mk('hsk');
  put('manifest.json');
  put('files.json');
  mk('es', 'dict', 'shards');
  put('es/dict/shards/000.json');
  mk('lessons');
  put('lessons/hsk1/lesson-1.json');
  put('achievements.json');

  cleanGenerated(out);

  assert.equal(fs.existsSync(path.join(out, 'dict')), false);
  assert.equal(fs.existsSync(path.join(out, 'strokes')), false);
  assert.equal(fs.existsSync(path.join(out, 'sentences')), false);
  assert.equal(fs.existsSync(path.join(out, 'hsk')), false);
  assert.equal(fs.existsSync(path.join(out, 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(out, 'files.json')), false);
  assert.ok(fs.existsSync(path.join(out, 'es/dict/shards/000.json')), 'ES dictionary survives');
  assert.ok(fs.existsSync(path.join(out, 'lessons/hsk1/lesson-1.json')), 'lessons survive');
  assert.ok(fs.existsSync(path.join(out, 'achievements.json')), 'hand-made content survives');
  fs.rmSync(out, { recursive: true, force: true });
});

test('C4: build-data no longer deletes public/data wholesale', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/build-data.mjs'), 'utf8');
  assert.doesNotMatch(src, /rmSync\(OUT,/);
  assert.match(src, /cleanGenerated\(OUT\)/);
});

// ---------------------------------------------------------------- I18
test('I18: exportAll never includes a legacy settings.openrouterKey', async () => {
  const storage = createStorage(memoryDriver());
  await storage.set('settings', 'openrouterKey', 'sk-secret');
  await storage.set('settings', 'theme', 'dark');
  const exported = await exportAll(storage);
  const json = JSON.stringify(exported);
  assert.ok(!json.includes('sk-secret'), 'key must not leave the device');
  assert.equal(exported.stores.settings.theme, 'dark');
});

test('I18: migrateSecrets moves settings.openrouterKey to meta', async () => {
  const storage = createStorage(memoryDriver());
  await storage.set('settings', 'openrouterKey', 'sk-secret');
  await migrateSecrets(storage);
  assert.equal(await storage.get('settings', 'openrouterKey'), undefined);
  assert.equal(await storage.get('meta', 'openrouterKey'), 'sk-secret');
});

test('I18: isSecret covers the secret keys only', () => {
  assert.equal(isSecret('meta', 'openrouterKey'), true);
  assert.equal(isSecret('meta', 'installDate'), false);
  assert.equal(isSecret('settings', 'openrouterKey'), true);
  assert.equal(isSecret('settings', 'theme'), false);
  assert.equal(isSecret('progress', 'hsk1'), false);
});

test('I18: push never uploads a legacy settings.openrouterKey', async () => {
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
  await storage.set('settings', 'openrouterKey', 'sk-secret');
  await storage.set('settings', 'theme', 'dark');
  const res = await sync.push();
  assert.equal(res.ok, true);
  assert.equal(rows.some((r) => r.store === 'settings' && r.key === 'openrouterKey'), false);
  assert.equal(rows.some((r) => r.store === 'settings' && r.key === 'theme'), true);
});

test('I18: pull ignores a remote settings.openrouterKey row', async () => {
  const remote = [
    { store: 'settings', key: 'openrouterKey', value: 'sk-secret', updated_at: '2024-01-01T00:00:00Z', deleted: false },
  ];
  const fetchImpl = async (url) => {
    if (String(url).includes('/auth/v1/verify')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'T', user: { id: 'u1' } }) };
    }
    return { ok: true, status: 200, json: async () => remote };
  };
  const storage = createStorage(memoryDriver());
  const sync = createSync({ fetch: fetchImpl, storage, config: { url: 'https://x.test', anonKey: 'k' } });
  await sync.verifyOtp('a@b.c', '1');
  const res = await sync.pull();
  assert.equal(res.ok, true);
  assert.equal(await storage.get('settings', 'openrouterKey'), undefined);
});
// ---------------------------------------------------------------- C1
const MODELS = [
  { id: 'openai/gpt-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
  { id: 'deepseek/deepseek-chat:free', pricing: { prompt: '0', completion: '0' } },
];

test('C1: initialModel picks a free model so the key alone is enough', () => {
  assert.equal(initialModel(MODELS), 'deepseek/deepseek-chat:free');
  assert.equal(initialModel([]), '');
  const provider = configuredProviders({ openrouterKey: 'sk', openrouterModel: initialModel(MODELS) })
    .find((p) => p.id === 'openrouter');
  assert.equal(provider.available(), true);
  // Without a saved model the provider is unavailable — the bug this guards.
  const bare = configuredProviders({ openrouterKey: 'sk', openrouterModel: '' })
    .find((p) => p.id === 'openrouter');
  assert.equal(bare.available(), false);
});

test('C1: nextFreeModel never returns the current model or an empty id', () => {
  assert.equal(nextFreeModel(MODELS, 'deepseek/deepseek-chat:free'), '');
  assert.equal(nextFreeModel([...MODELS, { id: 'qwen/qwen:free' }], 'deepseek/deepseek-chat:free'), 'qwen/qwen:free');
  assert.equal(nextFreeModel([], ''), '');
});

// ---------------------------------------------------------------- I2
// C1 and the lessons/tones half of I2 are covered by behaviour tests in
// review3-critical.test.mjs ("with only the API key the model list unlocks the
// chat", "a second click on Finish does not announce the lesson twice" and the
// three I4 DOM cases). What has no screen-level test yet is the exercise
// Continue button's own re-entrancy guard, so that one stays a source check.
test('I2: the exercise Continue button disables itself', () => {
  const view = fs.readFileSync(path.join(ROOT, 'src/learn/exercise-view.js'), 'utf8');
  assert.match(view, /if \(button\.disabled\) return;/);
  assert.match(view, /button\.disabled = true;/);
});

// ---------------------------------------------------------------- I4 + I7
test('I7/M2: the data cache is stamped from the data, not fixed (I4 kept)', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /const DATA_CACHE = 'chino-data-dev'/, 'the source carries a stampable name');
  assert.match(sw, /isImmutableData/);
  assert.match(sw, /if \(cached && isImmutableData\(new URL\(request\.url\)\)\) return cached;/);

  const { dataCacheVersion } = await import('../scripts/lib/data-version.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chino-datav-'));
  try {
    // Every source the SW serves cache-first must take part in the version.
    const sources = [
      'dict/shards/000.json',
      'es/dict/shards/000.json',
      'search-es/a.json',
      'strokes/shards/000.json',
    ];
    for (const rel of sources) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), '[{"id":1}]');
    }
    const v1 = await dataCacheVersion(dir);
    assert.equal(await dataCacheVersion(dir), v1, 'same data -> same version (I4)');
    for (const rel of sources) {
      const original = fs.readFileSync(path.join(dir, rel), 'utf8');
      fs.writeFileSync(path.join(dir, rel), `${original} `);
      assert.notEqual(await dataCacheVersion(dir), v1, `${rel} rotates the cache (M2)`);
      fs.writeFileSync(path.join(dir, rel), original);
    }
    assert.equal(await dataCacheVersion(dir), v1, 'restoring the data restores the version');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M1: the SW hands the refresh to waitUntil before respondWith settles', () => {
  // A `waitUntil` called from inside the refresh `.then` throws
  // InvalidStateError in browsers that follow the spec (and the refresh is
  // silently lost). The fake event fails if it is called after respondWith.
  const src = fs
    .readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
    .replace("const VERSION = 'dev';", "const VERSION = 'test';");
  const listeners = {};
  const cachesStub = {
    open: async () => ({ put: async () => {} }),
    match: async () => null,
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'http://localhost' },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetchStub = async () => ({ ok: true, status: 200, clone() { return this; } });
  const ResponseStub = { error: () => ({ error: true }) };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', src)(self, cachesStub, fetchStub, ResponseStub, URL);

  const order = [];
  const event = {
    request: { url: 'http://localhost/data/dict/manifest.json', method: 'GET' },
    respondWith() { this.responded = true; order.push('respondWith'); },
    waitUntil() {
      if (this.responded) throw new Error('waitUntil called after respondWith');
      order.push('waitUntil');
    },
  };
  listeners.fetch(event);
  assert.deepEqual(order, ['waitUntil', 'respondWith'], 'waitUntil must come first');
});

/** Loads sw.js with a fake `caches`/`fetch` and returns the fetch listener plus
 *  the response the fake network hands back. */
function makeSwHarness({ put }) {
  const src = fs
    .readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
    .replace("const VERSION = 'dev';", "const VERSION = 'test';");
  const listeners = {};
  const cachesStub = {
    open: async () => ({ put }),
    match: async () => null,
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'http://localhost' },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const networkResponse = { ok: true, status: 200, fromNetwork: true, clone() { return this; } };
  const fetchStub = async () => networkResponse;
  const ResponseStub = { error: () => ({ error: true }) };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', src)(self, cachesStub, fetchStub, ResponseStub, URL);
  return { listeners, networkResponse };
}

test('I1: a failed cache.put does not fail the response the network gave', async () => {
  // `put` fails on every shard once the origin quota is full (the chat keeps
  // ~1 GB of WebLLM weights in the Cache API). The page must still get the
  // network response, not Response.error().
  const { listeners, networkResponse } = makeSwHarness({
    put: async () => { throw new Error('QuotaExceededError'); },
  });
  let responded = null;
  let network = null;
  listeners.fetch({
    request: { url: 'http://localhost/data/lessons/hsk1/lesson-01.json', method: 'GET' },
    respondWith(promise) { responded = promise; },
    waitUntil(promise) { network = promise; },
  });
  assert.equal(await responded, networkResponse, 'the network response reaches the page');
  await network; // and the rejected put is swallowed by the waitUntil chain
});

test('I1: waitUntil still covers the cache write (the put is inside the chain)', async () => {
  let releasePut;
  const putDone = new Promise((resolve) => { releasePut = resolve; });
  const { listeners } = makeSwHarness({ put: () => putDone });
  let network = null;
  listeners.fetch({
    request: { url: 'http://localhost/data/lessons/hsk1/lesson-01.json', method: 'GET' },
    respondWith() {},
    waitUntil(promise) { network = promise; },
  });
  let settled = false;
  network.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false, 'waitUntil waits for the cache write');
  releasePut();
  await network;
  assert.equal(settled, true);
});

test('I1/M2: the SW reloads the page only when a controller already existed', async () => {
  const { registerServiceWorker } = await import('../src/pwa.js');
  const realNavigator = globalThis.navigator;
  const hadLocation = 'location' in globalThis;
  const realLocation = globalThis.location;
  const run = (hasController) => {
    const listeners = {};
    let reloads = 0;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          controller: hasController ? {} : null,
          register: async () => ({}),
          addEventListener: (type, fn) => { listeners[type] = fn; },
        },
      },
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { protocol: 'https:', pathname: '/', search: '', reload: () => { reloads += 1; } },
    });
    registerServiceWorker();
    listeners.controllerchange?.();
    return reloads;
  };
  try {
    assert.equal(run(false), 0, 'a first visit must not reload (I1)');
    assert.equal(run(true), 1, 'a real update reloads once');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: realNavigator });
    if (hadLocation) Object.defineProperty(globalThis, 'location', { configurable: true, value: realLocation });
    else delete globalThis.location;
  }
});

// ---------------------------------------------------------------- I7
test('I7: the licence and attribution ship with the build', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chino-build-'));
  try {
    execFileSync(process.execPath, ['scripts/build.mjs'], {
      cwd: ROOT,
      env: { ...process.env, OUT_DIR: out },
      stdio: 'pipe',
    });
    assert.ok(fs.existsSync(path.join(out, 'CREDITS.md')), 'CREDITS.md is copied');
    assert.ok(fs.existsSync(path.join(out, 'data/es/dict/LICENSE.md')), 'the ES dict licence ships');
    const lic = fs.readFileSync(path.join(out, 'data/es/dict/LICENSE.md'), 'utf8');
    assert.match(lic, /by-sa\/4\.0/);
    assert.match(lic, /CC-CEDICT/);
    // I7: the built service worker carries a data-derived cache name.
    const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
    assert.match(sw, /const DATA_CACHE = 'chino-data-[0-9a-f]{12}'/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('I7: Ajustes links to the licence and to CC-CEDICT', () => {
  const settings = fs.readFileSync(path.join(ROOT, 'src/extras/settings.js'), 'utf8');
  assert.match(settings, /by-sa\/4\.0/);
  assert.match(settings, /mdbg\.net/);
});

// ---------------------------------------------------------------- I15
test('I15: the rows sheet prints the pinyin even with steps off', async () => {
  const { planWorksheet, drawWorksheetPage } = await import('../src/extras/worksheet-rows.js');
  const plan = planWorksheet([{ character: '你', pinyin: 'nǐ', strokes: 7 }], {
    showSteps: false,
    showPinyin: true,
  });
  const texts = [];
  const ctx = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'fillText') return (text) => texts.push(text);
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  drawWorksheetPage(ctx, plan.pages[0], plan, {});
  assert.ok(texts.includes('nǐ'), `pinyin printed, got: ${texts.join(', ')}`);
});

// ---------------------------------------------------------------- I11
test('I11: the chat translation follows the app language', async () => {
  const { buildSystemPrompt, parseReply } = await import('../src/chat/prompts.js');
  assert.match(buildSystemPrompt({ uiLang: 'es' }), /Spanish/);
  assert.match(buildSystemPrompt({ uiLang: 'en' }), /English/);
  assert.equal(parseReply('{"zh":"你好","tr":"Hola"}').en, 'Hola');
});

// ---------------------------------------------------------------- I9
test('I9: a card added from the dictionary keeps the Spanish gloss', async () => {
  const { makeCard } = await import('../src/srs.js');
  const card = makeCard({ simp: '你', pinyin: 'nǐ', defs: ['you'], defsEs: ['tú'], source: 'dict' });
  assert.deepEqual(card.meaningEs, ['tú']);
  assert.deepEqual(card.defs, ['you']);
  const bare = makeCard({ simp: '你', defs: ['you'] });
  assert.deepEqual(bare.meaningEs, [], 'no translation still yields an array');
});

test('I9: review prefers the Spanish gloss in locale es', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/review.js'), 'utf8');
  assert.match(src, /getLocale\(\) === 'es' && Array\.isArray\(card\.meaningEs\)/);
  const paste = fs.readFileSync(path.join(ROOT, 'src/extras/paste.js'), 'utf8');
  assert.match(paste, /lookup\(word, \{ spanish: getLocale\(\) === 'es' \}\)/);
});
