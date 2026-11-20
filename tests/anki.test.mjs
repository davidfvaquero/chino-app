/**
 * Anki export/import — pure logic with an in-memory storage. No browser.
 * Run: node --test tests/anki.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, memoryDriver } from '../src/storage.js';
import { createDeck } from '../src/srs.js';
import {
  ANKI_COLUMNS,
  detectSeparator,
  exportCards,
  exportFilename,
  importCards,
  loadCards,
  parseAnkiTsv,
  previewImport,
  sourcesOf,
  splitRow,
} from '../src/anki.js';

const emptyDb = () => createStorage(memoryDriver());

/** Seeds cards through the real deck API; `example` is written onto the record. */
async function seed(db, list) {
  const deck = createDeck(db);
  for (const { example, ...entry } of list) {
    const { card } = await deck.addToReview(entry);
    if (example) await db.set('srs', card.id, { ...card, example });
  }
}

/** The fields that must survive export -> import. */
const view = (cards) =>
  cards
    .map((c) => ({
      hanzi: c.hanzi,
      pinyin: c.pinyin,
      english: c.english,
      example: c.example ?? '',
      source: c.source,
      sourceDetail: c.sourceDetail ?? null,
    }))
    .sort((a, b) => a.hanzi.localeCompare(b.hanzi));

const SEED = [
  { hanzi: '你', pinyin: 'nǐ', english: ['you'], source: 'lesson', sourceDetail: 'hsk1-lesson-01', example: '你好吗？' },
  { hanzi: '好', pinyin: 'hǎo', english: ['good', 'well'], source: 'lesson', sourceDetail: 'hsk1-lesson-01' },
  { hanzi: '人', pinyin: 'rén', english: ['person', 'people'], source: 'dict', sourceDetail: null },
];

test('splitRow: quoted cells keep tabs, quotes and separators', () => {
  assert.deepEqual(splitRow('a\t"b\tc"\td', '\t'), ['a', 'b\tc', 'd']);
  assert.deepEqual(splitRow('"say ""hi"""\tx', '\t'), ['say "hi"', 'x']);
  assert.deepEqual(splitRow('这是"测试"\tx', '\t'), ['这是"测试"', 'x']); // unquoted quotes stay literal
  assert.deepEqual(splitRow('a\t', '\t'), ['a', '']);
});

test('detectSeparator: tab, semicolon, comma, default tab', () => {
  assert.equal(detectSeparator('a\tb,c'), '\t');
  assert.equal(detectSeparator('Hanzi;Pinyin;Meaning'), ';');
  assert.equal(detectSeparator('Hanzi,Pinyin,Meaning'), ',');
  assert.equal(detectSeparator('single'), '\t');
});

test('exportCards writes Anki headers and the six columns', () => {
  const tsv = exportCards([{ hanzi: '你', pinyin: 'nǐ', english: ['you'], source: 'dict', sourceDetail: 'hsk1-lesson-01' }]);
  const [sep, html, cols, row] = tsv.split('\n');
  assert.equal(sep, '#separator:tab');
  assert.equal(html, '#html:true');
  assert.equal(cols, `#columns:${ANKI_COLUMNS.join('\t')}`);
  assert.equal(row, '你\tnǐ\tyou\t\tdict\thsk:1 detail:hsk1-lesson-01');
  assert.ok(tsv.endsWith('\n'));
});

test('exportCards escapes HTML, newlines, tabs and quotes', () => {
  const tsv = exportCards([
    { hanzi: '人', pinyin: 'rén', english: ['a < b & c\nnext', 'say "hi"\tnow'], example: '', source: 'dict' },
  ]);
  const row = tsv.split('\n')[3];
  assert.equal(row, '人\trén\t"a &lt; b &amp; c next; say ""hi""\tnow"\t\tdict\t');
});

test('exportCards with no cards gives header only', () => {
  assert.equal(exportCards([]).split('\n').filter(Boolean).length, 3);
});

test('round trip: seed 3 cards, export, reimport into empty storage gives the same cards', async () => {
  const source = emptyDb();
  await seed(source, SEED);
  const before = view(await loadCards(source));
  assert.equal(before.length, 3);

  const tsv = exportCards(await loadCards(source));
  const parsed = parseAnkiTsv(tsv);
  assert.equal(parsed.errors.length, 0);

  const target = emptyDb();
  assert.deepEqual(await previewImport(parsed.entries, target), { new: 3, existing: 0 });
  assert.deepEqual(await importCards(parsed.entries, target), { added: 3, skipped: 0 });
  assert.deepEqual(view(await loadCards(target)), before);
});

test('round trip keeps tabs, quotes and HTML characters inside fields', async () => {
  const hard = '这是一个"测试"\t<b>R&D</b>';
  const source = emptyDb();
  await seed(source, [{ hanzi: '测试', pinyin: 'cè shì', english: ['quiz\tbreak', 'say "ok"'], source: 'dict', example: hard }]);
  const before = view(await loadCards(source));
  const parsed = parseAnkiTsv(exportCards(await loadCards(source)));
  assert.equal(parsed.errors.length, 0);
  const target = emptyDb();
  await importCards(parsed.entries, target);
  assert.deepEqual(view(await loadCards(target)), before);
  assert.equal((await loadCards(target))[0].example, hard);
});

test('duplicates: existing hanzi and repeats inside one file are skipped', async () => {
  const db = emptyDb();
  await seed(db, [{ hanzi: '你', pinyin: 'nǐ', english: ['you'], source: 'lesson' }]);
  const text = [
    '#separator:tab',
    '#columns:Hanzi\tPinyin\tMeaning',
    '你\tnǐ\tyou',
    '好\thǎo\tgood',
    '好\thǎo\tgood again',
  ].join('\n');
  const parsed = parseAnkiTsv(text);
  assert.deepEqual(await previewImport(parsed.entries, db), { new: 1, existing: 2 });
  assert.deepEqual(await importCards(parsed.entries, db), { added: 1, skipped: 2 });
  assert.equal((await loadCards(db)).length, 2);
  assert.deepEqual(await importCards(parsed.entries, db), { added: 0, skipped: 3 });
});

test('parse: Anki file with directives, header row and HTML, numeric pinyin converted', () => {
  const text = [
    '#separator:Tab',
    '#html:true',
    '#notetype:Basic',
    '#deck:Chinese',
    'Hanzi\tPinyin\tMeaning\tTags',
    '<b>你</b>\tni3 hao3\tyou there; hi\thsk1 chinese',
    '\tno hanzi here\tx',
  ].join('\n');
  const { entries, errors } = parseAnkiTsv(text);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hanzi, '你');
  assert.equal(entries[0].pinyin, 'nǐ hǎo');
  assert.deepEqual(entries[0].english, ['you there', 'hi']);
  assert.equal(entries[0].sourceDetail, 'hsk1');
  assert.equal(entries[0].source, 'anki');
  assert.equal(errors.length, 1);
});

test('parse: comma-separated file with header and default column order without header', () => {
  const csv = 'Hanzi,Pinyin,Meaning\n你,nǐ,you\n好,hǎo,good';
  assert.deepEqual(parseAnkiTsv(csv).entries.map((e) => e.hanzi), ['你', '好']);
  const noHeader = '你\tnǐ\tyou\t你好吗\tlesson\thsk:1 detail:hsk1-lesson-02';
  const [e] = parseAnkiTsv(noHeader).entries;
  assert.equal(e.example, '你好吗');
  assert.equal(e.sourceDetail, 'hsk1-lesson-02');
});

test('loadCards filters by source; sourcesOf lists distinct sources', async () => {
  const db = emptyDb();
  await seed(db, SEED);
  assert.deepEqual(sourcesOf(await loadCards(db)), ['dict', 'lesson']);
  assert.deepEqual((await loadCards(db, { source: 'lesson' })).map((c) => c.hanzi).sort(), ['你', '好']);
});

test('exportFilename uses the local date', () => {
  assert.match(exportFilename(new Date(2026, 10, 19).getTime()), /^chino-anki-2026-11-19\.tsv$/);
});

test('I12: importing 5000 cards is linear and stays under 1 s', async () => {
  const db = emptyDb();
  const lines = ['#separator:tab', `#columns:${ANKI_COLUMNS.join('\t')}`];
  for (let i = 0; i < 5000; i += 1) {
    const ch = String.fromCodePoint(0x4e00 + i);
    lines.push(`${ch}\tpy${i}\tmeaning ${i}`);
  }
  const { entries } = parseAnkiTsv(lines.join('\n'));
  assert.equal(entries.length, 5000);
  const started = performance.now();
  const result = await importCards(entries, db);
  const elapsed = performance.now() - started;
  assert.equal(result.added, 5000);
  assert.ok(elapsed < 1000, `import of 5000 cards took ${elapsed.toFixed(0)} ms (expected < 1000)`);
});
