/**
 * dict-es.test.mjs — synthetic, offline tests for the Spanish dictionary
 * pipeline: the CC-CEDICT marker glossary / deterministic templates, the
 * strict-response parser, the validator rules and resumption (idempotency).
 * No network, no public/data writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  templateDefToEs, isTemplateDef, classifyEntry, resolveTemplateDefs, translateNotes,
  markersIn, parseTranslation, validateEntry, parentheticalLeaks, GLOSSARY, buildBatches,
  computeToDo, mergeShardEntries, estimateTokens, costUsd,
} from '../scripts/lib/dict-es.mjs';
import { selectStrata, SYSTEM, parseArgs, anthropicBody, handleAnthropicResponse, failReason } from '../scripts/translate-dict.mjs';

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

test('notes: parenthetical usage notes are translated (§3.4)', () => {
  assert.equal(translateNotes('variant of 潔|洁[jie2] (mostly used in given names)'),
    'variant of 潔|洁[jie2] (se usa mayormente en nombres propios)');
  assert.equal(translateNotes('x (idiom)'), 'x (modismo)');
  assert.equal(translateNotes('x (literary)'), 'x (literario)');
  assert.equal(translateNotes('y (used in Taiwan)'), 'y (used in Taiwan)'); // unknown note: untouched
  // deterministically, inside the template pass too
  assert.equal(templateDefToEs('variant of 潔|洁[jie2] (mostly used in given names)'),
    'variante de 潔|洁[jie2] (se usa mayormente en nombres propios)');
  assert.deepEqual(resolveTemplateDefs(['surname Wang', 'variant of 潔|洁[jie2] (mostly used in given names)']),
    ['apellido Wang', 'variante de 潔|洁[jie2] (se usa mayormente en nombres propios)']);
});

test('glossary: carries the pilot fixes and the frequent English notes', () => {
  const g = new Map(GLOSSARY);
  assert.equal(g.get('mostly used in given names'), 'se usa mayormente en nombres propios');
  for (const m of ['(idiom)', '(literary)', '(coll.)', '(loanword)', '(bound form)', '(name)', '(old)', '(math.)', '(computing)', '(bird species of China)']) {
    assert.ok(g.has(m), `falta la nota ${m} en el glosario`);
    assert.notEqual(g.get(m), m.replace(/^\(|\)$/g, ''), `la nota ${m} no está traducida`);
  }
});

test('prompt: SYSTEM carries the five pilot corrections', () => {
  // §3.1 duplicate senses, §3.2 hypernyms, §3.3 grammatical category, §3.4 templates, §3.5 regional
  assert.match(SYSTEM, /Never repeat the same Spanish term/);
  assert.match(SYSTEM, /avoid generic hypernyms \(caer, herir, romper\)/);
  assert.match(SYSTEM, /SAME grammatical category/);
  assert.match(SYSTEM, /including parenthetical usage notes/);
  assert.match(SYSTEM, /regional variants/);
  assert.match(SYSTEM, /se usa mayormente en nombres propios/);
});

// ---------------------------------------------------------------- parsing
test('parseTranslation: strict but tolerates a json fence', () => {
  const en = [{ id: 1, defs: ['to go'] }, { id: 2, defs: ['king', 'ruler'] }];
  const good = parseTranslation('```json\n[{"id":1,"defs":["ir"]},{"id":2,"defs":["rey","gobernante"]}]\n```', en);
  assert.equal(good.ok, true);
  assert.deepEqual(good.entries[1].defs, ['rey', 'gobernante']);
  assert.equal(parseTranslation('no soy json', en).ok, false);
  assert.equal(parseTranslation('[{"id":1,"defs":["ir"]}]', en).ok, false);           // falta id 2
  // fewer defs = a documented merge (rules 6/10); more defs = always a bug
  assert.equal(parseTranslation('[{"id":1,"defs":["ir"]},{"id":2,"defs":["rey"]}]', en).ok, true);
  assert.equal(parseTranslation('[{"id":1,"defs":["ir","x","y"]},{"id":2,"defs":["rey","gobernante"]}]', en).ok, false);
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
  assert.ok(validateEntry(two, { id: 9, defs: ['rey', 'gobernante', 'soberano'] }).some((m) => m.includes('nº defs')));
  assert.deepEqual(validateEntry(two, { id: 9, defs: ['rey'] }), []);   // merge allowed
  assert.ok(validateEntry(two, { id: 9, defs: ['rey', '   '] }).some((m) => m.includes('vacía')));
  assert.ok(validateEntry(two, { id: 9, defs: ['rey', 'gobernante\u0007'] }).some((m) => m.includes('control')));
  // too short / too long relative to the English
  assert.ok(validateEntry({ id: 1, defs: ['a very long english definition here'] }, { id: 1, defs: ['x'] }).some((m) => m.includes('corta')));
  assert.ok(validateEntry({ id: 1, defs: ['king'] }, { id: 1, defs: ['rey '.repeat(50)] }).some((m) => m.includes('larga')));
  // a proper noun with no translatable word is not an "english leak"
  assert.deepEqual(validateEntry({ id: 3, defs: ['Wang'] }, { id: 3, defs: ['Wang'] }), []);
});

test('validateEntry: a duplicated definition in one entry is an ERROR (§3.1)', () => {
  const en = { id: 121806, defs: ['to embody', 'to incarnate'] };
  assert.deepEqual(validateEntry(en, { id: 121806, defs: ['encarnar', 'reflejar'] }), []);
  const dup = validateEntry(en, { id: 121806, defs: ['encarnar', 'encarnar'] });
  assert.ok(dup.some((m) => m.includes('duplicada')), `esperaba duplicada, dio ${JSON.stringify(dup)}`);
  // whitespace/case/punctuation do not hide a duplicate
  assert.ok(validateEntry(en, { id: 1, defs: ['Encarnar!', 'encarnar'] }).some((m) => m.includes('duplicada')));
  // the merged form is not a duplicate
  assert.deepEqual(validateEntry(en, { id: 121806, defs: ['encarnar (tomar forma humana)'] }), []);
});

test('parentheticalLeaks: an English usage note kept verbatim is a warning (§3.4)', () => {
  const en = { id: 179, defs: ['variant of 潔|洁[jie2] (mostly used in given names)'] };
  const leaked = parentheticalLeaks(en, { id: 179, defs: ['variante de 潔|洁[jie2] (mostly used in given names)'] });
  assert.equal(leaked.length, 1);
  assert.match(leaked[0], /nota parentética sin traducir/);
  // translated note, the same in both languages, or a proper name: no warning
  assert.deepEqual(parentheticalLeaks(en, { id: 179, defs: ['variante de 潔|洁[jie2] (se usa mayormente en nombres propios)'] }), []);
  assert.deepEqual(parentheticalLeaks({ id: 1, defs: ['to see (lit.)'] }, { id: 1, defs: ['véase (lit.)'] }), []);
  assert.deepEqual(parentheticalLeaks({ id: 2, defs: ['a tree (Quercus)'] }, { id: 2, defs: ['un árbol (Quercus)'] }), []);
  assert.deepEqual(parentheticalLeaks({ id: 3, defs: ['rat snake (Ptyas mucosus)'] }, { id: 3, defs: ['serpiente rata (Ptyas mucosus)'] }), []);
  assert.equal(parentheticalLeaks({ id: 4, defs: ['x (medicinal)'] }, { id: 4, defs: ['x (medicinal)'] }).length, 1);
  // and the deterministic template pass fixes it without any LLM
  assert.deepEqual(parentheticalLeaks(en, { id: 179, defs: resolveTemplateDefs(en.defs) }), []);
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

// ---------------------------------------------------------------- thinking off
test('anthropic: the request disables thinking and raises max_tokens (offline)', () => {
  const body = JSON.parse(anthropicBody({ model: 'claude-haiku-5-5' }, [{ id: 1, defs: ['to go'] }]));
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.model, 'claude-haiku-5-5');
});

test('anthropic: a truncated reply (stop_reason max_tokens) is invalid, reason "truncado"', () => {
  const en = [{ id: 1, defs: ['to go'] }, { id: 2, defs: ['king'] }];
  const trunc = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '[{"id":1,"defs":["ir"]},{"id":2,"de' }] };
  assert.throws(() => handleAnthropicResponse(trunc, en), (e) => failReason(e) === 'truncado');
  assert.throws(() => handleAnthropicResponse(trunc, en), /truncada|max_tokens/);
});

test('anthropic: an empty thinking block does not hide a valid text block', () => {
  const en = [{ id: 1, defs: ['to go'] }];
  const ok = { stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '[{"id":1,"defs":["ir"]}]' }] };
  assert.deepEqual(handleAnthropicResponse(ok, en).entries, [{ id: 1, defs: ['ir'] }]);
  // no text block at all (only thinking) = empty reply
  const onlyThink = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'x' }] };
  assert.throws(() => handleAnthropicResponse(onlyThink, en), (e) => failReason(e) === 'vacío');
});

test('failReason: classifies the measured failure modes', () => {
  assert.equal(failReason(new Error('JSON inválido: Unterminated string in JSON at position 765')), 'json');
  assert.equal(failReason(new Error('respuesta sin contenido')), 'vacío');
  assert.equal(failReason(new Error('falta el id 42')), 'formato');
  assert.equal(failReason(new Error('HTTP 500: sin detalle')), 'http');
  assert.equal(failReason(new Error('vaya')), 'otro');
});

test('parseArgs: Claude defaults to 30-entry batches, openrouter to 40', () => {
  assert.equal(parseArgs([]).batch, 30);
  assert.equal(parseArgs(['--provider', 'openrouter']).batch, 40);
  assert.equal(parseArgs(['--batch', '50']).batch, 50);
});
