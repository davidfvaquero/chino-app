/**
 * design-screens.test.mjs — guard for the "papel y tinta" pass over the
 * remaining screens (t_756e8edf). Static check, no browser:
 *   - module-injected CSS must not branch on `prefers-color-scheme` (tokens
 *     are ONE light-dark() declaration; see docs/DESIGN.md §2);
 *   - it must not hard-code colours (hex) outside a `@media print` block.
 * If a screen needs a colour, use a token from src/styles.css.
 *
 * The list below mixes committed screens with modules a sibling task is still
 * writing (e.g. src/learn/games/builder.js). A clean clone only has the
 * committed ones, so every file that is not on disk yet is skipped; REQUIRED
 * pins the screens that must already exist, so accidentally deleting one still
 * fails the test instead of silently shrinking the audit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const FILES = [
  'src/learn/tones.js',
  'src/learn/pinyin-chart.js',
  'src/learn/strokes.js',
  'src/learn/strokes-sheet.js',
  'src/learn/sentences.js',
  'src/learn/themes.js',
  'src/learn/grammar.js',
  'src/learn/radicals.js',
  'src/learn/dictation.js',
  'src/learn/hardwords.js',
  'src/learn/plan.js',
  'src/learn/exam.js',
  'src/learn/typing.js',
  'src/learn/games.js',
  'src/learn/games/builder.js',
  'src/learn/games/matching.js',
  'src/learn/games/memory.js',
  'src/learn/games/timed.js',
  'src/extras/profile.js',
  'src/extras/stats.js',
  'src/extras/settings.js',
  'src/extras/backup.js',
  'src/extras/paste.js',
  'src/extras/pronounce.js',
  'src/extras/draw.js',
  'src/extras/worksheet.js',
];

/** Long-committed screens: must never disappear (guards the skip below). */
const REQUIRED = [
  'src/learn/tones.js',
  'src/learn/strokes.js',
  'src/learn/radicals.js',
  'src/extras/settings.js',
  'src/extras/backup.js',
];

const pathOf = (file) => new URL(`../${file}`, import.meta.url);

/** Drop balanced `@media print { ... }` blocks (print ink is not a screen token). */
function stripPrint(css) {
  let out = css, i;
  while ((i = out.indexOf('@media print')) !== -1) {
    let j = out.indexOf('{', i), depth = 0, k = j;
    for (; k < out.length; k++) {
      if (out[k] === '{') depth++;
      else if (out[k] === '}' && --depth === 0) break;
    }
    out = out.slice(0, i) + out.slice(k + 1);
  }
  return out;
}

const cssOf = (src) => {
  const m = src.match(/const CSS = `([\s\S]*?)\n`;/);
  return m ? m[1] : '';
};

test('REQUIRED screens still exist', () => {
  for (const file of REQUIRED) assert.ok(existsSync(pathOf(file)), `${file} disappeared`);
});

test('screen CSS uses design tokens, never prefers-color-scheme', () => {
  for (const file of FILES) {
    if (!existsSync(pathOf(file))) continue; // not committed yet (sibling task) — skip
    const src = readFileSync(pathOf(file), 'utf8');
    assert.ok(!src.includes('prefers-color-scheme'), `${file}: use tokens, not prefers-color-scheme`);
    const css = stripPrint(cssOf(src));
    const hex = [...new Set(css.match(/#[0-9a-fA-F]{3,8}\b/g) || [])];
    assert.deepEqual(hex, [], `${file}: hard-coded colours in CSS (${hex.join(', ')}) — use a --token`);
  }
});

test('the every-area audit lists the redesigned screens', () => {
  const audit = readFileSync(new URL('../scripts/lib/audit.mjs', import.meta.url), 'utf8');
  for (const route of ['#/learn/strokes', '#/learn/pinyin-chart', '#/learn/radicals', '#/extras/settings', '#/extras/backup']) {
    assert.ok(audit.includes(route), `audit.mjs must cover ${route}`);
  }
});
