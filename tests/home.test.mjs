import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMergedLocale } from '../scripts/build-locales.mjs';
import { dayKey, dayNumber, pickWordOfDay, goalProgress, findNextLesson, chooseNextStep } from '../src/screens/home.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('chooseNextStep: due cards win, then lesson, then reading, then learn menu', () => {
  const lesson = { id: 'hsk1-03', title: 'Everyday things' };
  const reading = { id: 'reading-02', title: '我的家' };
  assert.deepEqual(chooseNextStep({ due: 4, lesson, reading }), { kind: 'review', path: 'review', n: 4 });
  assert.deepEqual(chooseNextStep({ due: 0, lesson, reading }), { kind: 'lesson', path: 'learn/lessons/hsk1-03', title: 'Everyday things' });
  assert.deepEqual(chooseNextStep({ lesson: null, reading }), { kind: 'read', path: 'read/reading-02', title: '我的家' });
  assert.deepEqual(chooseNextStep({}), { kind: 'learn', path: 'learn' });
});

test('findNextLesson skips completed lessons and returns null when all are done', async () => {
  const index = { lessons: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const done = new Set(['a']);
  const progressOf = async (id) => (done.has(id) ? { completed: true } : id === 'b' ? { completed: false, answered: 2 } : null);
  assert.equal((await findNextLesson(index, progressOf)).id, 'b');
  done.add('b');
  assert.equal((await findNextLesson(index, async () => ({ completed: true }))), null);
  assert.equal(await findNextLesson(null, progressOf), null);
});

test('word of the day: deterministic per date, changes next day, covers all words over a cycle', () => {
  const items = Array.from({ length: 150 }, (_, i) => ({ hanzi: `w${i}` }));
  const d = new Date(2026, 10, 18, 3);
  assert.equal(pickWordOfDay(items, d), pickWordOfDay(items, new Date(2026, 10, 18, 23)));
  assert.notEqual(pickWordOfDay(items, d), pickWordOfDay(items, new Date(2026, 10, 19)));
  const seen = new Set();
  for (let i = 0; i < 150; i += 1) seen.add(pickWordOfDay(items, new Date(2026, 0, 1 + i)).hanzi);
  assert.equal(seen.size, 150);
  assert.equal(pickWordOfDay([], d), null);
});

test('dayKey / dayNumber use the local date', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayNumber(new Date(2026, 0, 6)) - dayNumber(new Date(2026, 0, 5, 23, 59)), 1);
});

test('goalProgress clamps, handles 0 and invalid goals', () => {
  assert.deepEqual(goalProgress(5, 20), { done: 5, goal: 20, pct: 25, reached: false });
  assert.deepEqual(goalProgress(30, 20), { done: 30, goal: 20, pct: 100, reached: true });
  assert.equal(goalProgress(undefined, undefined).goal, 20);
  assert.equal(goalProgress(-3, 10).done, 0);
});

test('every hub area has a resolvable title and Home keys exist', async () => {
  const en = await loadMergedLocale(new URL('../src/locales/', import.meta.url), 'en');
  const get = (key) => key.split('.').reduce((o, k) => o?.[k], en);
  for (const [file, hub] of [['src/screens/learn.js', 'learn'], ['src/screens/extras.js', 'extras']]) {
    const areas = read(file).match(/const AREAS = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    assert.ok(areas.length >= 7, `${hub} areas`);
    for (const area of areas) {
      const key = read(`src/${hub}/${area}.js`).match(/^export const titleKey = '([^']+)'/m)[1];
      assert.equal(typeof get(key), 'string', `${hub}/${area} titleKey ${key} missing in locale`);
    }
  }
  for (const key of ['screens.home.title', 'nav.home', 'nav.more', 'home.next.title', 'home.wotd.title', 'home.goal.title', 'home.level.hsk1', 'home.level.practical']) {
    assert.equal(typeof get(key), 'string', key);
  }
});

test('learn hub lists all required areas and extras hub lists all required areas', () => {
  const areasOf = (file) => read(file).match(/const AREAS = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  for (const a of ['lessons', 'tones', 'strokes', 'sentences', 'pinyin-chart', 'themes', 'dictation', 'games', 'radicals', 'hardwords']) assert.ok(areasOf('src/screens/learn.js').includes(a), a);
  for (const a of ['paste', 'backup', 'settings', 'stats', 'profile', 'draw', 'pronounce']) assert.ok(areasOf('src/screens/extras.js').includes(a), a);
});
