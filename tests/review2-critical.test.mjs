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

test('C1: paint loads models before checking the provider', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/extras/conversation.js'), 'utf8');
  const paint = src.slice(src.indexOf('function paint()'), src.indexOf('async function loadModelsOnce'));
  assert.match(paint, /loadModelsOnce\(\);\s*\n\s*const provider/);
  const load = src.slice(src.indexOf('async function loadModelsOnce'));
  assert.match(load, /initialModel\(state\.models\)/);
});

// ---------------------------------------------------------------- I2
test('I2: Continue disables itself and Finalizar announces the lesson once', () => {
  const view = fs.readFileSync(path.join(ROOT, 'src/learn/exercise-view.js'), 'utf8');
  assert.match(view, /if \(button\.disabled\) return;/);
  assert.match(view, /button\.disabled = true;/);
  const lessons = fs.readFileSync(path.join(ROOT, 'src/learn/lessons.js'), 'utf8');
  assert.match(lessons, /let completed = false;/);
  assert.match(lessons, /if \(completed\) return;/);
  assert.match(lessons, /\.finally\(\(\) => \{/);
  const tones = fs.readFileSync(path.join(ROOT, 'src/learn/tones.js'), 'utf8');
  assert.match(tones, /if \(completed\) return;/);
  assert.match(tones, /\.finally\(\(\) => \{/);
});
