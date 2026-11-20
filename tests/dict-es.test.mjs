/**
 * dict-es.test.mjs — synthetic, offline tests for the Spanish dictionary
 * pipeline: the CC-CEDICT marker glossary / deterministic templates, the
 * strict-response parser, the validator rules and resumption (idempotency).
 * No network, no public/data writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  templateDefToEs, isTemplateDef, classifyEntry, resolveTemplateDefs,
  markersIn, parseTranslation, validateEntry, buildBatches,
  computeToDo, mergeShardEntries, estimateTokens, costUsd,
} from '../scripts/lib/dict-es.mjs';
import { selectStrata } from '../scripts/translate-dict.mjs';

// ---------------------------------------------------------------- glossary
test('templates: bare CC-CEDICT markers translate deterministically', () => {
  assert.equal(templateDefToEs('surname Wang'), 'apellido Wang');
  assert.equal(templateDefToEs('variant of 好[hao3]'), 'variante de 好[hao3]');
  assert.equal(templateDefToEs('old variant of 好[hao3]'), 'variante antigua de 好[hao3]');
  assert.equal(templateDefToEs('CL:個|个[ge4]'), 'clasificador:個|个[ge4]');
  // hanzi / brackets preserved, non-template text untouched
  assert.equal(templateDefToEs('to go'), 'to go');
});

test('classifyEntry: only all-marker entries are templates', () => {
  assert.equal(classifyEntry({ defs: ['surname Wang'] }), 'template');
  assert.equal(classifyEntry({ defs: ['variant of 好[hao3]', 'CL:個[ge4]'] }), 'template');
  assert.equal(classifyEntry({ defs: ['surname Wang', 'king'] }), null);
  assert.equal(classifyEntry({ defs: ['king; ruler'] }), null);
  assert.equal(isTemplateDef('erhua variant of 玩[wan2]'), true);
  assert.deepEqual(resolveTemplateDefs(['surname Li', 'variant of 里[li3]']),
    ['apellido Li', 'variante de 里[li3]']);
});

test('markersIn: the most specific marker wins (no false "variant of")', () => {
  const md = markersIn('old variant of 好[hao3]');
  assert.deepEqual(md, [['old variant of', 'variante antigua']]);
  assert.deepEqual(markersIn('see also 好[hao3]'), [['see also', 'véase']]);
  // the verb "see" is not the marker
  assert.deepEqual(markersIn('to see; to look at'), []);
  assert.deepEqual(markersIn('see 好[hao3]'), [['see', 'véase']]);
});

// ---------------------------------------------------------------- parsing
test('parseTranslation: strict but tolerates a json fence', () => {
  const en = [{ id: 1, defs: ['to go'] }, { id: 2, defs: ['king', 'ruler'] }];
  const good = parseTranslation('```json\n[{"id":1,"defs":["ir"]},{"id":2,"defs":["rey","gobernante"]}]\n```', en);
  assert.equal(good.ok, true);
  assert.deepEqual(good.entries[1].defs, ['rey', 'gobernante']);
  assert.equal(parseTranslation('no soy json', en).ok, false);
  assert.equal(parseTranslation('[{"id":1,"defs":["ir"]}]', en).ok, false);           // falta id 2
  assert.equal(parseTranslation('[{"id":1,"defs":["ir"]},{"id":2,"defs":["rey"]}]', en).ok, false); // 1 def
  assert.equal(parseTranslation('[{"id":1,"defs":["ir"]},{"id":2,"defs":["rey",""]}]', en).ok, false); // vacía
});

// ---------------------------------------------------------------- validation
test('validateEntry: a good translation passes', () => {
  const en = { id: 5, simp: '去', pinyin: 'qù', defs: ['to go', 'to leave'] };
  const es = { id: 5, defs: ['ir', 'marcharse'] };
  assert.deepEqual(validateEntry(en, es), []);
});

test('validateEntry: catches the real failure modes', () => {
  const en = { id: 5, simp: '王', pinyin: 'Wáng', defs: ['surname Wang'] };
  assert.ok(validateEntry(en, { id: 5, defs: ['surname Wang'] }).length, 'english leak + marker');
  assert.deepEqual(validateEntry(en, { id: 5, defs: ['apellido Wang'] }), []);

  const he = { id: 7, defs: ['variant of 好[hao3]'] };
  assert.ok(validateEntry(he, { id: 7, defs: ['variante de'] }).some((m) => m.includes('falta preservar')), 'hanzi/bracket perdido');
  assert.ok(validateEntry(he, { id: 7, defs: ['variant of 好[hao3]'] }).length, 'marcador sin traducir');
  assert.deepEqual(validateEntry(he, { id: 7, defs: ['variante de 好[hao3]'] }), []);

  const two = { id: 9, defs: ['king', 'ruler'] };
  assert.ok(validateEntry(two, { id: 9, defs: ['rey'] }).some((m) => m.includes('nº defs')));
  assert.ok(validateEntry(two, { id: 9, defs: ['rey', '   '] }).some((m) => m.includes('vacía')));
  assert.ok(validateEntry(two, { id: 9, defs: ['rey', 'gobernante\u0007'] }).some((m) => m.includes('control')));
  // too short / too long relative to the English
  assert.ok(validateEntry({ id: 1, defs: ['a very long english definition here'] }, { id: 1, defs: ['x'] }).some((m) => m.includes('corta')));
  assert.ok(validateEntry({ id: 1, defs: ['king'] }, { id: 1, defs: ['rey '.repeat(50)] }).some((m) => m.includes('larga')));
  // a proper noun with no translatable word is not an "english leak"
  assert.deepEqual(validateEntry({ id: 3, defs: ['Wang'] }, { id: 3, defs: ['Wang'] }), []);
});

// ---------------------------------------------------------------- resumption
test('resumption: done ids are skipped, shards merge without duplicating', () => {
  const ids = [1, 2, 3, 4];
  assert.deepEqual(computeToDo(ids, new Set([2, 4])), [1, 3]);
  assert.deepEqual(computeToDo(ids, new Set()), ids);

  const existing = [{ id: 1, defs: ['uno'] }, { id: 2, defs: ['dos'] }];
  const fresh = [{ id: 2, defs: ['DOS (rehecho)'] }, { id: 3, defs: ['tres'] }];
  assert.deepEqual(mergeShardEntries(existing, fresh), [
    { id: 1, defs: ['uno'] }, { id: 2, defs: ['DOS (rehecho)'] }, { id: 3, defs: ['tres'] },
  ]);
});

test('buildBatches / cost helpers', () => {
  assert.deepEqual(buildBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(estimateTokens(0, 0), 0);
  assert.ok(costUsd(1e6, 0) > 0);
});

test('selectStrata: 300 unique ids, 20 from the template tier', () => {
  const tiers = {
    '1': Array.from({ length: 500 }, (_, i) => i),
    '2': Array.from({ length: 500 }, (_, i) => 1000 + i),
    template: Array.from({ length: 50 }, (_, i) => 5000 + i),
  };
  const sample = selectStrata({ tiers });
  assert.equal(sample.length, 300);
  assert.equal(new Set(sample).size, 300);
  assert.equal(sample.filter((id) => id >= 5000).length, 20);
});
