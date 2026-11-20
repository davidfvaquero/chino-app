// Design round 2, task B — grouped Learn/More menus, the clear pinyin chip,
// 11 px tab labels, reduced-motion feedback and the dotted strokes grid.
// Static, browser-free. Run with `node --test tests/design-ronda2b.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const json = (rel) => JSON.parse(src(rel));

const areasOf = (text) =>
  [...text.match(/const AREAS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const groupsOf = (text) =>
  [...text.match(/const GROUPS = \[([\s\S]*?)\n\];/)[1].matchAll(/\{ key: '([^']+)', areas: \[([^\]]*)\] \}/g)].map(
    (m) => ({ key: m[1], areas: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) }),
  );

// --------------------------------------------------------------- hub groups

const HUBS = [
  ['learn', 'src/screens/learn.js'],
  ['extras', 'src/screens/extras.js'],
];

for (const [hub, file] of HUBS) {
  test(`${hub}: every destination appears in exactly one block`, () => {
    const text = src(file);
    const areas = areasOf(text);
    const groups = groupsOf(text);
    const grouped = groups.flatMap((g) => g.areas);
    assert.deepEqual([...grouped].sort(), [...areas].sort(), `${hub}: grouped set differs from AREAS`);
    assert.equal(new Set(grouped).size, grouped.length, `${hub}: an area is grouped twice`);
    assert.equal(groups.length, 3, `${hub}: expected three blocks with a header`);
  });
}

test('both hubs carry a header for every block in both locales', () => {
  const en = json('src/locales/en.d/hubs.json');
  const es = json('src/locales/es.d/hubs.json');
  for (const [hub] of HUBS) {
    const enKeys = Object.keys(en.hubs[hub].groups).sort();
    const esKeys = Object.keys(es.hubs[hub].groups).sort();
    assert.deepEqual(esKeys, enKeys, `${hub}: group keys differ between locales`);
    for (const key of enKeys) {
      assert.ok(en.hubs[hub].groups[key].trim(), `en ${hub}.${key} empty`);
      assert.ok(es.hubs[hub].groups[key].trim(), `es ${hub}.${key} empty`);
    }
  }
});

for (const [hub, file] of HUBS) {
  test(`${hub}: renders one labelled .menu-group per block`, () => {
    const text = src(file);
    assert.match(text, /class: 'menu-group'/);
    assert.match(text, /class: 'menu-group-title'/);
    assert.match(text, /aria-labelledby/);
  });
}

// --------------------------------------------------------------- pinyin chip

test('the pinyin chip carries aria-pressed and a text on/off state', () => {
  const s = src('src/settings.js');
  assert.match(s, /'aria-pressed'/);
  assert.match(s, /settings\.pinyin\.quickState/);
  assert.match(s, /settings\.pinyin\.on/);
  assert.match(s, /settings\.pinyin\.off/);
  // It is no longer a plain chip (a tab-like control): a readable ghost button.
  assert.match(s, /class: 'btn ghost sm pinyin-toggle'/);
});

test('the pinyin quick state text exists in both locales', () => {
  for (const code of ['en', 'es']) {
    const value = json(`src/locales/${code}.d/settings.json`).settings.pinyin.quickState;
    assert.equal(typeof value, 'string');
    assert.match(value, /Pinyin: \{state\}/);
  }
});

// ------------------------------------------------------------- bottom bar

test('bottom-bar labels are at least 11 px', () => {
  const css = src('src/styles.css');
  const tabBlock = css.match(/\.tab \{[^}]*\}/s)[0];
  const size = Number(tabBlock.match(/font-size:\s*(\d+(?:\.\d+)?)px/)[1]);
  assert.ok(size >= 11, `.tab font-size is ${size}px, expected >= 11px`);
});

// --------------------------------------------------------- reduced motion

test('reduced motion keeps the state but drops the shake/pop', () => {
  const css = src('src/styles.css');
  const block = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(block, /\.btn\.is-wrong,\s*\.btn\.is-correct\s*\{\s*animation:\s*none/);
});

// --------------------------------------------------------------- strokes

test('the strokes board uses the dotted practice grid and the sheet wording', () => {
  const s = src('src/learn/strokes.js');
  const guide = s.match(/\.strokes-guide \{[^}]*\}/)[0];
  assert.match(guide, /stroke-dasharray/);
  assert.match(guide, /stroke: var\(--grid\)/);
  assert.equal(json('src/locales/es.d/strokes.json').strokes.searchButton, 'Ver trazos');
  assert.equal(json('src/locales/en.d/strokes.json').strokes.searchButton, 'Show strokes');
});

// --------------------------------------------------------------- read screen

test('the reader gives its speakers an accessible name', () => {
  assert.match(src('src/screens/read.js'), /'aria-label': t\('read\.speaker'/);
  assert.match(json('src/locales/es.d/read.json').read.speaker, /Hablante \{name\}/);
  assert.match(json('src/locales/en.d/read.json').read.speaker, /Speaker \{name\}/);
});

// ------------------------------------------- secondary actions as ghost buttons

test('review, dictionary, strokes and read mark secondary actions as ghost', () => {
  assert.match(src('src/screens/read.js'), /'btn ghost sm'/);
  assert.match(src('src/screens/review.js'), /'btn ghost/);
  assert.match(src('src/screens/dictionary.js'), /'btn ghost sm/);
  assert.match(src('src/learn/strokes.js'), /'btn ghost strokes/);
});
