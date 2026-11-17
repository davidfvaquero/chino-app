/**
 * Profile screen tests — verifies the screen module contract and locale keys.
 * Uses node:test + node:assert/strict (no browser needed).
 */
import { describe, it } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { loadMergedLocale } from '../scripts/build-locales.mjs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as fs from 'node:fs';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const localesDir = url.pathToFileURL(path.resolve(__dirname, '../src/locales') + '/').href;

describe('profile screen', () => {
  it('module keeps the screen contract (titleKey + render)', async () => {
    const mod = await import('../src/extras/profile.js');
    ok(typeof mod.titleKey === 'string' && mod.titleKey.length > 0, 'exports titleKey');
    ok(typeof mod.render === 'function', 'exports render function');
  });

  it('every static text key used by the screen exists in the shard or shell', async () => {
    const locale = await loadMergedLocale(localesDir, 'en');
    // Keys used by src/extras/profile.js (all under profileScreen.*)
    const required = [
      'profileScreen.emptyState.title',
      'profileScreen.emptyState.description',
      'profileScreen.emptyState.startLearning',
      'profileScreen.streak.current',
      'profileScreen.streak.best',
      'profileScreen.streak.days',
      'profileScreen.points',
      'profileScreen.level',
      'profileScreen.achievements.title',
      'profileScreen.achievements.unlocked',
      'profileScreen.achievements.locked',
      'profileScreen.achievements.empty',
      'profileScreen.achievements.unlockAt',
      'profileScreen.language.label',
      'profileScreen.language.current',
    ];
    for (const key of required) {
      const val = key.split('.').reduce((o, k) => o?.[k], locale);
      ok(typeof val === 'string', `missing locale key: ${key}`);
    }
  });

  it('the profile shard only owns profileScreen.* keys and collides with nothing', async () => {
    const shardPath = path.resolve(__dirname, '../src/locales/en.d/profile.json');
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf-8'));
    const keys = Object.keys(shard);
    ok(keys.length === 1 && keys[0] === 'profileScreen', 'shard has exactly one top-level key: profileScreen');
    // Deep check: all leaves under profileScreen
    function collectLeaves(obj, prefix = '') {
      const out = [];
      for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...collectLeaves(v, full));
        else out.push(full);
      }
      return out;
    }
    const leaves = collectLeaves(shard.profileScreen, 'profileScreen');
    for (const leaf of leaves) {
      ok(leaf.startsWith('profileScreen.'), `leaf key ${leaf} does not start with profileScreen.`);
    }
  });
});