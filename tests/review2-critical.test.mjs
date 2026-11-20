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

test('I18: isSecret covers meta and the legacy settings key only', () => {
  assert.equal(isSecret('meta', 'anything'), true);
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