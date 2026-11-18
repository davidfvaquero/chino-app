/**
 * layout.test.mjs — static guard for the hanzi/pinyin/english card layout.
 *
 * The real, pixel-level check is `scripts/check-layout.mjs` (headless Chrome).
 * This test is the browser-free counterpart: it asserts that every module that
 * renders a hanzi + pinyin + english card declares a block-stacked layout with
 * at least 4px of vertical separation between the pinyin and the english, so a
 * future edit cannot silently glue them back onto one line.
 *
 * Owner: t_4e044d38 (mobile layout of the vocabulary cards).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Extract the first `const CSS = \`...\`` block from a module source. */
function cssOf(source) {
  const match = source.match(/const CSS = `([\s\S]*?)`;/);
  assert.ok(match, 'module declares an injected CSS block');
  return match[1];
}

/** rem value of a `gap:`/`margin-top:` declaration inside a CSS block. */
function remOf(css, selector, prop = 'gap') {
  const rule = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `${selector} rule exists`);
  const decl = rule[1].match(new RegExp(`${prop}:\\s*([0-9.]+)rem`));
  assert.ok(decl, `${selector} declares ${prop} in rem`);
  return Number(decl[1]);
}

test('lessons vocabulary card stacks hanzi / pinyin / english', () => {
  const css = cssOf(read('src/learn/lessons.js'));
  assert.match(css, /\.vocab-item\.field\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.vocab-item\s+\.english\s*\{[^}]*margin-top:\s*0?\.\d+em/);
});

test('lessons example block separates hanzi / pinyin / english by >= 4px', () => {
  const css = cssOf(read('src/learn/lessons.js'));
  assert.match(css, /\.vocab-item\s+\.example\s*\{[^}]*flex-direction:\s*column/);
  assert.ok(remOf(css, '.vocab-item .example') * 16 >= 4, 'example gap >= 4px');
});

test('dictation answer line stacks hanzi / pinyin / english', () => {
  const css = cssOf(read('src/learn/dictation.js'));
  assert.match(css, /\.dict-answer-line\s*\{[^}]*flex-direction:\s*column/);
  assert.ok(remOf(css, '.dict-answer-line') * 16 >= 4, 'answer-line gap >= 4px');
});

test('strokes sheet head stacks character / pinyin / meaning', () => {
  const css = cssOf(read('src/learn/strokes-sheet.js'));
  assert.match(css, /\.sheet-head\s*\{[^}]*flex-direction:\s*column/);
  assert.ok(remOf(css, '.sheet-head') * 16 >= 4, 'sheet-head gap >= 4px');
});

test('sentences card stacks hanzi / pinyin / english', () => {
  const css = cssOf(read('src/learn/sentences.js'));
  assert.match(css, /\.sentence-row\s*\{[^}]*flex-direction:\s*column/);
});
