// Isolated dialogue tests (docs/dialogue-schema.md).
//
// - index: 30 pre-defined entries, 10 per level, ids dialogue-01..30.
// - every committed `dialogue-NN.json` is validated against the schema and the
//   HSK vocabulary of its level; a dialogue whose file is not written yet is
//   skipped (the index runs ahead of the content tasks).
// - the pure logic behind the two practice modes ("You are B", "Order the
//   dialogue") is exercised with no DOM and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LEVELS,
  loadIndex,
  loadDialogue,
  filterByLevel,
  normalizeDialogue,
  shuffle,
  buildChoice,
  choiceRounds,
  isCorrectChoice,
  orderRound,
  isOrdered,
} from '../src/learn/dialogues.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const DIALOGUES = path.join(DATA, 'dialogues');

const HANZI = /[\u3400-\u9fff\uf900-\ufaff]/;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Injected fetch that resolves file URLs (used by the loadIndex/loadDialogue test). */
const fileUrlFetch = async (url) => JSON.parse(await fs.promises.readFile(fileURLToPath(url), 'utf8'));

/** Allowed hanzi for a dialogue at `level`: HSK words of that level or lower. */
const hskChars = new Map();
for (let level = 1; level <= 3; level++) {
  const words = readJson(path.join(DATA, 'hsk', `${level}.json`)).items.map((item) => item.hanzi);
  hskChars.set(level, new Set([...(hskChars.get(level - 1) ?? []), ...words.join('')]));
}
/** Short allowlist: proper names that are not HSK vocabulary. */
const NAMES = new Set([...'王李华张伟美']);
const allowedFor = (level) => new Set([...hskChars.get(Number(String(level).replace('hsk', ''))), ...NAMES]);

/* -------------------------------------------------------------- loaders -- */

test('the loaders read the index and one dialogue through the injected fetch', async () => {
  const base = pathToFileURL(`${DIALOGUES}/`);
  const index = await loadIndex({ base, fetchJson: fileUrlFetch });
  assert.equal(index.length, 30);
  const one = await loadDialogue('dialogue-01', { base, fetchJson: fileUrlFetch });
  assert.equal(one.id, 'dialogue-01');
  assert.equal(one.level, 'hsk1');
  assert.equal(one.lines.length, 8);
});

/* -------------------------------------------------------------- index --- */

test('the index pre-defines 30 dialogues, 10 per level, with hanzi + English titles', () => {
  const index = readJson(path.join(DIALOGUES, 'index.json'));
  assert.equal(index.length, 30);
  const counts = { hsk1: 0, hsk2: 0, hsk3: 0 };
  index.forEach((entry, i) => {
    assert.equal(entry.id, `dialogue-${String(i + 1).padStart(2, '0')}`, `entry ${i} has the expected id`);
    assert.ok(HANZI.test(entry.title), `${entry.id}: title is hanzi`);
    assert.ok(entry.titleEn && !HANZI.test(entry.titleEn), `${entry.id}: titleEn is English`);
    assert.ok(entry.topic && !HANZI.test(entry.topic), `${entry.id}: topic is English`);
    assert.ok(LEVELS.includes(entry.level), `${entry.id}: level is one of ${LEVELS.join('/')}`);
    counts[entry.level] += 1;
  });
  assert.deepEqual(counts, { hsk1: 10, hsk2: 10, hsk3: 10 });
});

test('filterByLevel keeps only the requested level', () => {
  const index = readJson(path.join(DIALOGUES, 'index.json'));
  assert.equal(filterByLevel(index, 'hsk1').length, 10);
  assert.ok(filterByLevel(index, 'hsk3').every((e) => e.level === 'hsk3'));
  assert.equal(filterByLevel(index, 'nonsense').length, 10, 'an unknown level falls back to hsk1');
});

/* ------------------------------------------- schema + HSK vocabulary --- */

for (const meta of readJson(path.join(DIALOGUES, 'index.json'))) {
  const file = path.join(DIALOGUES, `${meta.id}.json`);
  const skip = !fs.existsSync(file);
  const opts = { skip, todo: skip ? 'dialogue not written yet' : undefined };

  test(`dialogues/${meta.id}: schema`, opts, () => {
    const raw = readJson(file);
    assert.equal(raw.id, meta.id, 'id matches the index and the file name');
    assert.equal(raw.title, meta.title, 'index title matches the dialogue');
    assert.equal(raw.titleEn, meta.titleEn, 'index titleEn matches the dialogue');
    assert.equal(raw.topic, meta.topic, 'index topic matches the dialogue');
    assert.equal(raw.level, meta.level, 'index level matches the dialogue');
    assert.ok(Array.isArray(raw.lines) && raw.lines.length >= 8, 'has at least 8 lines');
    raw.lines.forEach((line, i) => {
      for (const key of ['zh', 'pinyin', 'en']) assert.ok(line[key], `${meta.id}: line ${i} empty ${key}`);
      assert.ok(HANZI.test(line.zh), `${meta.id}: line ${i} has no hanzi`);
      const expected = i % 2 === 0 ? 'A' : 'B';
      assert.equal(line.speaker, expected, `${meta.id}: line ${i} speaker alternates from A`);
    });
  });

  test(`dialogues/${meta.id}: every character is HSK ${meta.level.slice(3)} or lower`, opts, () => {
    const raw = readJson(file);
    const allowed = allowedFor(meta.level);
    const bad = new Set();
    for (const line of raw.lines) {
      for (const char of line.zh) if (HANZI.test(char) && !allowed.has(char)) bad.add(char);
    }
    assert.deepEqual([...bad], [], `${meta.id} uses characters outside its level: ${[...bad].join('')}`);
  });
}

/* ----------------------------------------------------- Spanish copy --- */

test('a written dialogue has a matching Spanish structural copy', () => {
  const index = readJson(path.join(DIALOGUES, 'index.json'));
  for (const meta of index) {
    const enFile = path.join(DIALOGUES, `${meta.id}.json`);
    if (!fs.existsSync(enFile)) continue;
    const esFile = path.join(DATA, 'es', 'dialogues', `${meta.id}.json`);
    assert.ok(fs.existsSync(esFile), `${meta.id}: es copy missing`);
    const en = readJson(enFile);
    const es = readJson(esFile);
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), `${meta.id}: key sets differ`);
    assert.equal(es.lines.length, en.lines.length, `${meta.id}: line count differs`);
    en.lines.forEach((line, i) => {
      assert.equal(es.lines[i].zh, line.zh, `${meta.id}: line ${i} zh must match`);
      assert.equal(es.lines[i].pinyin, line.pinyin, `${meta.id}: line ${i} pinyin must match`);
      assert.equal(es.lines[i].speaker, line.speaker, `${meta.id}: line ${i} speaker must match`);
    });
  }
});

/* --------------------------------------------------------- pure logic -- */

const LINES = [
  { speaker: 'A', zh: '甲', pinyin: 'jiǎ', en: 'one' },
  { speaker: 'B', zh: '乙', pinyin: 'yǐ', en: 'two' },
  { speaker: 'A', zh: '丙', pinyin: 'bǐng', en: 'three' },
  { speaker: 'B', zh: '丁', pinyin: 'dīng', en: 'four' },
];

test('normalizeDialogue fills missing fields with empty strings', () => {
  const d = normalizeDialogue({ id: 'x', lines: [{ zh: '你' }] });
  assert.equal(d.title, '');
  assert.equal(d.level, 'hsk1');
  assert.deepEqual(d.lines[0], { speaker: '', zh: '你', pinyin: '', en: '' });
});

test('shuffle is a permutation and honours an injected rng', () => {
  const rng = () => 0; // deterministic: every pick is index 0
  const out = shuffle([1, 2, 3, 4], rng);
  assert.equal(out.length, 4);
  assert.deepEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepEqual(out, [2, 3, 4, 1]);
});

test('buildChoice offers the real reply plus two distractors', () => {
  const round = buildChoice(LINES, 1, () => 0);
  assert.equal(round.answer, '乙');
  assert.equal(round.options.length, 3);
  assert.equal(round.options.filter((o) => o.correct).length, 1);
  assert.ok(round.options.find((o) => o.zh === '乙')?.correct);
  assert.equal(new Set(round.options.map((o) => o.zh)).size, 3, 'options are distinct');
  assert.equal(round.prompt.zh, '甲', 'the prompt is the preceding A line');
  assert.equal(isCorrectChoice(round.options.find((o) => o.correct)), true);
  assert.equal(isCorrectChoice(round.options.find((o) => !o.correct)), false);
});

test('choiceRounds walk only the B turns', () => {
  const rounds = choiceRounds(LINES, () => 0.5);
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map((r) => r.index), [1, 3]);
  assert.deepEqual(rounds.map((r) => r.answer), ['乙', '丁']);
});

test('orderRound shuffles a copy and isOrdered checks the original order', () => {
  const { items, solution } = orderRound(LINES, () => 0);
  assert.equal(items.length, LINES.length);
  assert.notEqual(items, solution, 'items is a different array');
  assert.deepEqual(solution.map((l) => l.zh), ['甲', '乙', '丙', '丁'], 'the solution is the original order');
  assert.equal(isOrdered(solution, solution), true);
  assert.equal(isOrdered(LINES, solution), true);
  const wrong = [...solution].reverse();
  assert.equal(isOrdered(wrong, solution), false);
  assert.equal(isOrdered(solution.slice(0, 3), solution), false, 'a short list is not ordered');
});
