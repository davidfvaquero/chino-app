// tests/review8.test.mjs — regressions for docs/REVIEW-8.md (M2 wiring, M3).
//
// The REVIEW-7 fixes I2 (history tombstone) and I6 (order pool) lived in
// src/main.js and src/learn/lessons.js but their tests copied the logic instead
// of driving it, so reverting the wiring kept them green. These tests pin the
// wiring itself, on the real code, so the mutations die.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { installFakeDom } from './helpers/fake-dom.mjs';
import { registerLocale } from '../src/i18n.js';

const readJson = (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
// HSK2 lesson-04 has an order exercise whose authored tokens ARE the answer
// (上课), so an orderBody that skipped orderPool would ship it pre-solved.
const LESSON = readJson(new URL('../public/data/lessons/hsk2/lesson-04.json', import.meta.url));
const EN = { learn: readJson(new URL('../src/locales/en.d/learn.json', import.meta.url)).learn };
registerLocale('en', EN);

const readSource = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------- M2: I2 wiring (main)

test('M2: src/main.js retires the legacy secrets through the shared seam', () => {
  const src = readSource('src/main.js');
  assert.match(src, /retireLegacySecrets\(storage, sync\)/,
    'main.js must call retireLegacySecrets(storage, sync), not inline the migration');
});

// ------------------------------------------------------------- M3: exam wiring

test('M3: exam.js sends examLevel (not level) on lesson_done', () => {
  const src = readSource('src/learn/exam.js');
  assert.match(src, /lessonId: LESSON_ID,\s*\n\s*examLevel: state\.level,/,
    'the exam lesson_done detail must carry examLevel: state.level');
});

// ------------------------------------------------- M2: I6 wiring (order body)

test('M2: the order exercise renders a shuffled pool, never the answer in order', async () => {
  const dom = installFakeDom();
  try {
    await import('../src/data-url.js').then(({ configure }) =>
      configure({
        base: new URL('../public/data/', import.meta.url).href,
        fetch: async (url) => ({ ok: true, status: 200, json: async () => readJson(new URL(url)) }),
      }),
    );
    const { render } = await import('../src/learn/lessons.js');
    const container = new dom.FakeNode('div');
    await render(container, { route: { name: 'learn', segments: ['lessons', 'hsk2-04'] }, navigate() {} });

    container.querySelectorAll('.btn.primary')[0].click(); // intro -> vocabulary
    container.querySelectorAll('.btn.primary')[0].click(); // vocabulary -> exercises

    const clickByText = (text) =>
      container.descendants().findLast((n) => n.textContent.trim() === text).click();
    let preSolvedChecked = 0;
    for (const exercise of LESSON.exercises) {
      if (exercise.type === 'order') {
        const pool = container.querySelector('.pool-row');
        assert.ok(pool, 'the order exercise renders a .pool-row');
        const shown = pool.descendants()
          .filter((node) => node.classList.contains('chip-hanzi'))
          .map((node) => node.textContent.trim())
          .join('');
        assert.deepEqual([...shown].sort(), [...exercise.answer].sort(), 'the pool holds the answer tokens');
        assert.notEqual(shown, exercise.answer, `the pool must not start solved (${exercise.answer})`);
        if ([...exercise.tokens].join('') === exercise.answer) preSolvedChecked += 1;
        clickByText(EN.learn.lessons.check); // grade (empty) so the step can advance
      } else if (exercise.type === 'choose' || exercise.type === 'listen') {
        container.querySelectorAll('.btn.option')[0].click();
      } else if (exercise.type === 'match') {
        for (const pair of exercise.pairs) {
          container.descendants().find((n) => n.dataset.hanzi === pair.hanzi).click();
          container.descendants().find((n) => n.dataset.english === pair.english).click();
        }
        clickByText(EN.learn.lessons.check);
      }
      await tick();
      const box = container.querySelector('.feedback-box');
      if (box) box.querySelectorAll('.btn.primary')[0].click();
      await tick();
    }
    assert.ok(preSolvedChecked > 0, 'the fixture still has a pre-solved order exercise (test is not vacuous)');
  } finally {
    dom.restore();
  }
});
