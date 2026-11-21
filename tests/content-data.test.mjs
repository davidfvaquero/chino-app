// Consolidated content-data test (REVIEW.md #21).
//
// Walks EVERY lesson listed in each public/data/lessons/<level>/index.json and
// EVERY reading in public/data/readings/hsk1/index.json, with the checks the
// former per-batch tests and loose validator scripts performed: schema,
// exercise types, gradeable answers, plus reading segmentation. Pure Node,
// no browser, no network.
//
// It replaces: tests/readings-28-34.test.mjs, tests/hsk3-lessons-02-04.test.mjs,
// tests/hsk3-lessons-8-10.test.mjs, tests/check-readings.mjs,
// scripts/verify-readings.mjs, scripts/validate-hsk3-8-10.mjs and
// scripts/validate-lessons.mjs (see the task comment for the assertion
// before/after mapping).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadIndex, loadLesson } from '../src/learn/lessons.js';
import { gradeExercise } from '../src/learn/exercises.js';
import { segment, configure, lookup } from '../src/dictionary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const LESSONS_DIR = path.join(DATA, 'lessons');
const READINGS_DIR = path.join(DATA, 'readings', 'hsk1');
const readJsonFile = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readJson = async (url) => JSON.parse(fs.readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: new URL('../public/data/lessons/', import.meta.url), fetchJson: readJson };

const HANZI = /[\u3400-\u9fff]/;

/** The response that answers an exercise with its own answer (same contract as tests/exercises.test.mjs). */
const answerOf = (exercise) =>
  exercise.type === 'match'
    ? Object.fromEntries(exercise.pairs.map((pair) => [pair.hanzi, pair.english]))
    : exercise.type === 'order'
      ? exercise.answer.split('')
      : exercise.answer;

/* ------------------------------------------------------------- lessons -- */

// Traditional-only characters: appear in some HSK word's `trad` but in no
// word's simplified `hanzi` (same technique as tests/hsk3-lessons.test.mjs).
const simpChars = new Set();
const tradChars = new Set();
for (let level = 1; level <= 6; level++) {
  for (const word of readJsonFile(path.join(DATA, 'hsk', `${level}.json`)).items) {
    for (const c of word.hanzi) simpChars.add(c);
    for (const c of word.trad || '') tradChars.add(c);
  }
}
const tradOnly = new Set([...tradChars].filter((c) => !simpChars.has(c)));

const lessonLevels = fs
  .readdirSync(LESSONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(LESSONS_DIR, d.name, 'index.json')))
  .map((d) => d.name);

for (const level of lessonLevels) {
  const index = readJsonFile(path.join(LESSONS_DIR, level, 'index.json'));
  const sourceWords = /^public\/data\/hsk\//.test(index.source || '')
    ? readJsonFile(path.join(ROOT, index.source)).items
    : null;

  test(`${level}: the index matches the lesson files on disk`, () => {
    const listed = new Set(index.lessons.map((l) => l.file));
    const onDisk = fs.readdirSync(path.join(LESSONS_DIR, level)).filter((f) => f.endsWith('.json') && f !== 'index.json');
    // Only check files that exist on disk (future lessons are reserved in the index but not written yet).
    for (const file of onDisk) {
      assert.ok(listed.has(file), `${level}/${file} is listed in the index`);
    }
    // Don't assert that every listed file exists — future lessons are declared in the index before being written.
  });

  for (const meta of index.lessons) {
    test(`${level}/${meta.id}: schema, exercises, grading and simplified text`, async () => {
      const lessonPath = path.join(LESSONS_DIR, level, meta.file);
      // Skip lessons whose file does not exist yet (filler tasks will add them later).
      if (!fs.existsSync(lessonPath)) {
        return;
      }
      const lesson = await loadLesson(level, meta.id, opts);

      assert.equal(lesson.id, meta.id, 'lesson id matches the index');
      assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
      assert.ok(Array.isArray(lesson.vocabulary) && lesson.vocabulary.length >= 10, `has vocabulary (${lesson.vocabulary.length})`);
      assert.ok(Array.isArray(lesson.exercises) && lesson.exercises.length >= 4, `has exercises (${lesson.exercises.length})`);

      for (const word of lesson.vocabulary) {
        assert.ok(word.hanzi && word.pinyin && word.english, `vocabulary entry complete: ${JSON.stringify(word)}`);
      }

      // hsk3 8-10 (the former tests/hsk3-lessons-8-10.test.mjs) require an
      // example sentence on every word; keep that coverage here.
      if (level === 'hsk3' && ['hsk3-08', 'hsk3-09', 'hsk3-10'].includes(meta.id)) {
        for (const word of lesson.vocabulary) {
          assert.ok(word.example, `hsk3 8-10 word has an example: ${word.hanzi}`);
        }
      }

      const types = new Set(lesson.exercises.map((e) => e.type));
      for (const want of ['choose', 'listen', 'match', 'order']) {
        assert.ok(types.has(want), `uses the "${want}" exercise type`);
      }

      for (const exercise of lesson.exercises) {
        assert.ok(exercise.type && exercise.prompt, `exercise has a type and a prompt: ${JSON.stringify(exercise)}`);
        const result = gradeExercise(exercise, answerOf(exercise));
        assert.equal(result.correct, true, `${exercise.type} "${exercise.prompt}" grades as correct`);
      }

      const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
      const bad = [...new Set([...text].filter((c) => tradOnly.has(c)))];
      assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);

      if (sourceWords && meta.range && !meta.curated) {
        const expected = sourceWords.slice(meta.range.from - 1, meta.range.to).map((w) => w.hanzi);
        const got = lesson.vocabulary.map((w) => w.hanzi);
        assert.deepEqual(got, expected, `vocabulary is the HSK slice ${meta.range.from}..${meta.range.to}`);
      }
    });
  }
}

/* ------------------------------------------------------------ readings -- */

configure({
  fetch: async (url) => {
    const text = await fs.promises.readFile(path.join(DATA, url.replace(/^\/data\//, '')), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  },
});

const readingIndex = readJsonFile(path.join(READINGS_DIR, 'index.json'));

test('readings: the index matches the reading files on disk', () => {
  const listed = new Set(readingIndex.map((r) => r.id));
  const onDisk = fs.readdirSync(READINGS_DIR).filter((f) => /^reading-\d+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
  for (const id of listed) {
    assert.ok(fs.existsSync(path.join(READINGS_DIR, `${id}.json`)), `${id} from the index exists`);
  }
  for (const id of onDisk) {
    assert.ok(listed.has(id), `${id} is listed in the index`);
  }
});

for (const meta of readingIndex) {
  test(`readings/${meta.id}: schema, index agreement and segmentable hanzi`, async () => {
    const r = readJsonFile(path.join(READINGS_DIR, `${meta.id}.json`));

    assert.equal(r.id, meta.id);
    assert.ok(r.title && r.topic, 'has a title and a topic');
    assert.ok(['text', 'dialogue'].includes(r.type), `type is text or dialogue (got ${r.type})`);
    assert.ok(Array.isArray(r.lines) && r.lines.length > 0, 'has lines');
    assert.equal(meta.title, r.title, 'index title matches the reading');
    assert.equal(meta.topic, r.topic, 'index topic matches the reading');

    for (const line of r.lines) {
      for (const key of ['hanzi', 'pinyin', 'english']) assert.ok(line[key], `${meta.id}: empty ${key}`);
      if (r.type === 'dialogue') assert.ok(line.speaker, `${meta.id}: dialogue line without a speaker`);
      for (const token of await segment(line.hanzi)) {
        if (!HANZI.test(token)) continue;
        assert.ok(await lookup(token), `${meta.id}: "${token}" not in dictionary (${line.hanzi})`);
      }
    }
  });
}
