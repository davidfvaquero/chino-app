/**
 * review7.test.mjs — regressions for docs/REVIEW-7.md (I1-I6 and the cheap
 * minors). Each test dies if its fix is reverted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WEBLLM_CDN_URL } from '../src/chat/webllm-provider.js';
import { createStorage, memoryDriver } from '../src/storage.js';
import { migrateSecrets, retireLegacySecrets } from '../src/secrets.js';
import { createSync } from '../src/sync/client.js';
import { importAll } from '../src/backup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- I1: CSP

test('I1: the CSP allows WebLLM (jsDelivr + wasm) and any https host (Ollama)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(match, 'index.html has a Content-Security-Policy meta');
  const csp = match[1];
  const directive = (name) => {
    const found = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(name));
    return found ? found.slice(name.length).trim() : '';
  };

  const scriptSrc = directive('script-src');
  const webllmOrigin = new URL(WEBLLM_CDN_URL).origin;
  assert.ok(scriptSrc.includes(webllmOrigin), `script-src allows ${webllmOrigin} (got "${scriptSrc}")`);
  assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"), `script-src allows wasm (got "${scriptSrc}")`);

  const connectSrc = directive('connect-src');
  assert.ok(connectSrc.includes('https:'), `connect-src allows https hosts (got "${connectSrc}")`);
  assert.ok(connectSrc.includes("'self'"), `connect-src keeps 'self' (got "${connectSrc}")`);
  // The app never fetches a data: URL: the stroke check decodes its bitmaps
  // through a Blob (scripts/check-strokes-orient.mjs), so connect-src stays clean.
  assert.ok(!connectSrc.includes('data:'), `connect-src does not need data: (got "${connectSrc}")`);
});

// ------------------------------------------------- I2: private history sync

test('I2: migrateSecrets reports the keys it moved out of settings', async () => {
  const storage = createStorage(memoryDriver());
  await storage.set('settings', 'conversationHistory', [{ role: 'user', zh: '你好' }]);
  await storage.set('settings', 'openrouterKey', 'sk-test');
  const moved = await migrateSecrets(storage);
  assert.deepEqual(moved.sort(), ['conversationHistory', 'openrouterKey']);
  assert.equal(await storage.get('settings', 'conversationHistory'), undefined);
  assert.equal(await storage.get('settings', 'openrouterKey'), undefined);
  assert.deepEqual(await storage.get('meta', 'conversationHistory'), [{ role: 'user', zh: '你好' }]);
});

test('I2: a synced device tombstones the old settings row instead of resurrecting it', async () => {
  const storage = createStorage(memoryDriver());
  const history = [{ role: 'user', zh: '你好' }];
  await storage.set('settings', 'conversationHistory', history);
  await storage.set('meta', 'syncSession', { access_token: 'T' });

  const serverRows = new Map();
  const id = 'settings\u0000conversationHistory';
  serverRows.set(id, {
    store: 'settings', key: 'conversationHistory', value: history,
    updated_at: new Date().toISOString(), deleted: false,
  });
  const pushed = [];
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'POST') {
      const rows = JSON.parse(options.body);
      pushed.push(...rows);
      for (const row of rows) serverRows.set(`${row.store}\u0000${row.key}`, row);
      return { ok: true, status: 201, json: async () => rows };
    }
    return { ok: true, status: 200, json: async () => [...serverRows.values()] };
  };
  const sync = createSync({ fetch: fetchImpl, storage, config: { url: 'https://x.test', anonKey: 'k' } });

  // Drive the real boot seam (src/main.js uses the same call), then attach so
  // a later pull-merge-push is exercised.
  await retireLegacySecrets(storage, sync);
  sync.attach();
  const res = await sync.syncNow();

  assert.equal(res.ok, true);
  assert.equal(await storage.get('settings', 'conversationHistory'), undefined, 'local settings row stays gone');
  assert.deepEqual(await storage.get('meta', 'conversationHistory'), history, 'meta keeps the history');
  assert.equal(serverRows.get(id).deleted, true, 'server row is tombstoned');
  assert.ok(pushed.some((row) => row.store === 'settings' && row.key === 'conversationHistory' && row.deleted === true),
    'the tombstone is pushed');
});

test('I2: importing an old backup never writes the history into settings', async () => {
  const storage = createStorage(memoryDriver());
  await storage.set('meta', 'conversationHistory', [{ role: 'user', zh: '新' }]);
  await importAll(
    { app: 'chino-app', version: 1, exportedAt: Date.now(), stores: { settings: { conversationHistory: [{ role: 'user', zh: '旧' }] } } },
    { mode: 'merge' },
    storage,
  );
  assert.equal(await storage.get('settings', 'conversationHistory'), undefined);
  assert.deepEqual(await storage.get('meta', 'conversationHistory'), [{ role: 'user', zh: '新' }]);
});

// ------------------------------------------------------- I6: order exercises

test('I6: order pools are shuffled and never start already solved', async () => {
  const { orderPool } = await import('../src/learn/lessons.js');
  const tokens = ['我', '支', '持', '你'];
  const answer = '我支持你';

  const shuffled = orderPool(tokens, answer, () => 0);
  assert.deepEqual([...shuffled].sort(), [...tokens].sort(), 'same tokens, shuffled');
  assert.notEqual(shuffled.join(''), answer, 'not in answer order');

  // rng that returns the identity permutation: the guard must rotate it.
  const identity = orderPool(tokens, answer, () => 0.999999);
  assert.notEqual(identity.join(''), answer, 'the solved order is rotated');

  assert.deepEqual(orderPool(['我'], '我', () => 0.5), ['我'], 'single token untouched');
  assert.deepEqual(tokens, ['我', '支', '持', '你'], 'the source array is not mutated');
});
