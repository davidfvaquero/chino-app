/**
 * Etymology module: loader + rendering plan.
 * Browser-free on purpose — `renderEtymology()` is exercised in the browser
 * check; the data path and the block plan are pure and tested here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_ETYMOLOGY_BASE,
  configure,
  createEtymologyLoader,
  formatEtymology,
  getEtymology,
  normalizeCharacter,
} from '../src/etymology.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

/** fetchImpl that reads the real committed files, so the loader is tested as wired. */
async function fileFetch(url) {
  const match = url.match(/etymology\/(.+)$/);
  if (!match) throw new Error(`Unexpected etymology URL: ${url}`);
  const text = await fs.readFile(path.join(DATA, 'etymology', match[1]), 'utf8');
  return JSON.parse(text);
}

configure({ fetch: fileFetch });
const loader = createEtymologyLoader({
  base: new URL('file://' + path.join(DATA, 'etymology') + '/'),
  fetchImpl: fileFetch,
});

test('normalizeCharacter takes the first CJK char and survives junk', () => {
  assert.equal(normalizeCharacter('妈'), '妈');
  assert.equal(normalizeCharacter('  妈妈 '), '妈');
  assert.equal(normalizeCharacter('%E5%A6%88'), '妈');
  assert.equal(normalizeCharacter('⺊'), '⺊', 'radical symbols count too');
  assert.equal(normalizeCharacter('ma'), '');
  assert.equal(normalizeCharacter(''), '');
  assert.equal(normalizeCharacter(undefined), '');
  assert.equal(normalizeCharacter('%E4'), '');
});

test('好 is an ideographic compound with a woman/son hint', async () => {
  const entry = await getEtymology('好');
  assert.equal(entry.type, 'ideographic');
  assert.match(entry.hint, /woman/);
  assert.equal(entry.semantic, undefined);
  assert.equal(entry.phonetic, undefined);
});

test('妈 is pictophonetic: meaning part 女, sound part 马', async () => {
  const entry = await getEtymology('妈');
  assert.equal(entry.type, 'pictophonetic');
  assert.equal(entry.semantic, '女');
  assert.equal(entry.semanticGloss, 'woman');
  assert.equal(entry.phonetic, '马');
  assert.equal(entry.phoneticPinyin, 'mǎ');
});

test('pictographic characters keep their hint (女)', async () => {
  const entry = await getEtymology('女');
  assert.equal(entry.type, 'pictographic');
  assert.ok(entry.hint.length > 0);
});

test('a hint quoting a traditional-only character is dropped (马)', async () => {
  const entry = await getEtymology('马');
  assert.equal(entry.type, 'pictographic');
  assert.equal(entry.hint, undefined, 'Make Me a Hanzi says "Simplified form of 馬" — not shown');
});

test('characters without data return null', async () => {
  assert.equal(await getEtymology('的'), null, 'the most common character has no etymology entry');
  assert.equal(await getEtymology('nonsense'), null);
  assert.equal(await getEtymology(''), null);
  assert.equal(await loader.load('🀄'), null);
});

test('formatEtymology: parts row then hint story, i18n keys only', () => {
  assert.deepEqual(formatEtymology(null), []);
  assert.deepEqual(formatEtymology({}), []);

  const mother = formatEtymology({
    type: 'pictophonetic',
    hint: 'woman',
    semantic: '女',
    semanticGloss: 'woman',
    phonetic: '马',
    phoneticPinyin: 'mǎ',
  });
  assert.equal(mother.length, 2);
  assert.equal(mother[0].kind, 'parts');
  assert.deepEqual(mother[0].items, [
    { key: 'etymology.meaningPart', params: { char: '女', gloss: 'woman' } },
    { key: 'etymology.soundPart', params: { char: '马', pinyin: 'mǎ' } },
  ]);
  assert.deepEqual(mother[1], { kind: 'hint', text: 'woman' });

  // No hint at all -> only the parts row; missing gloss/pinyin -> the no-… keys.
  assert.deepEqual(formatEtymology({ type: 'pictophonetic', semantic: '女', phonetic: '马' }), [
    {
      kind: 'parts',
      items: [
        { key: 'etymology.meaningPartNoGloss', params: { char: '女' } },
        { key: 'etymology.soundPartNoPinyin', params: { char: '马' } },
      ],
    },
  ]);

  // A pictographic/ideographic character shows only its story.
  assert.deepEqual(formatEtymology({ type: 'ideographic', hint: 'A woman 女 with a son 子' }), [
    { kind: 'hint', text: 'A woman 女 with a son 子' },
  ]);

  // Type alone is nothing to show.
  assert.deepEqual(formatEtymology({ type: 'pictographic' }), []);
});

test('every entry has a known type and every shard range is sorted', async () => {
  const index = JSON.parse(await fs.readFile(path.join(DATA, 'etymology', 'index.json'), 'utf8'));
  assert.ok(index.shards.length > 0);
  const types = new Set(['pictophonetic', 'ideographic', 'pictographic']);
  let total = 0;
  let previous = null;
  for (const shard of index.shards) {
    assert.equal(shard.range[0].codePointAt(0) <= shard.range[1].codePointAt(0), true);
    if (previous !== null) assert.ok(shard.range[0].codePointAt(0) > previous, 'ranges ascend');
    previous = shard.range[1].codePointAt(0);
    const entries = await fileFetch(`${DEFAULT_ETYMOLOGY_BASE.href}${shard.file}`);
    const chars = Object.keys(entries);
    assert.equal(chars.length, shard.count);
    total += chars.length;
    for (const char of chars) {
      assert.equal(normalizeCharacter(char), char, `${char} is a single CJK char`);
      assert.ok(types.has(entries[char].type), `${char} has a known type`);
    }
  }
  assert.equal(total, index.characters);
});
