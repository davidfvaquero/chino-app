/**
 * tone.test.mjs — tests for src/tone.js
 * Run with: node --test tests/tone.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toneOf, pinyinHtml, isToneColorsOn, setToneColors } from '../src/tone.js';

// Inner markup of pinyinHtml(): the outer <span class="py"> is covered by its own test.
const pinyinBody = (s) => pinyinHtml(s).replace(/^<span class="py">([\s\S]*)<\/span>$/, '$1');

// --- toneOf -----------------------------------------------------------------

test('toneOf: detects tone from tone marks', () => {
  assert.equal(toneOf('nǐ'), 3);
  assert.equal(toneOf('hǎo'), 3);
  assert.equal(toneOf('mā'), 1);
  assert.equal(toneOf('má'), 2);
  assert.equal(toneOf('mǎ'), 3);
  assert.equal(toneOf('mà'), 4);
  assert.equal(toneOf('ma'), 5); // no mark -> neutral
});

test('toneOf: detects tone from tone numbers', () => {
  assert.equal(toneOf('ni3'), 3);
  assert.equal(toneOf('hao3'), 3);
  assert.equal(toneOf('ma1'), 1);
  assert.equal(toneOf('ma2'), 2);
  assert.equal(toneOf('ma3'), 3);
  assert.equal(toneOf('ma4'), 4);
  assert.equal(toneOf('ma5'), 5);
});

test('toneOf: handles ü/v normalization', () => {
  assert.equal(toneOf('lü4'), 4);
  assert.equal(toneOf('lv4'), 4);
  assert.equal(toneOf('nü3'), 3);
  assert.equal(toneOf('nv3'), 3);
  assert.equal(toneOf('Lǜ'), 4);
  assert.equal(toneOf('LV4'), 4);
  assert.equal(toneOf('nu:3'), 3);
});

test('toneOf: returns null for empty/invalid input', () => {
  assert.equal(toneOf(''), null);
  assert.equal(toneOf('   '), null);
  assert.equal(toneOf(null), null);
  assert.equal(toneOf(undefined), null);
});

// --- pinyinHtml -------------------------------------------------------------

test('pinyinHtml: tone marks input', () => {
  const html = pinyinBody('nǐ hǎo');
  assert.equal(html, '<span class="tone tone3">nǐ</span> <span class="tone tone3">hǎo</span>');
});

test('pinyinHtml: tone numbers input', () => {
  const html = pinyinBody('ni3 hao3');
  assert.equal(html, '<span class="tone tone3">ni</span> <span class="tone tone3">hao</span>');
});

test('pinyinHtml: neutral tone gets tone5', () => {
  const html = pinyinBody('ma5 ma');
  assert.equal(html, '<span class="tone tone5">ma</span> <span class="tone tone5">ma</span>');
});

test('pinyinHtml: mixed marks and numbers', () => {
  const html = pinyinBody('nǐ hao3');
  assert.equal(html, '<span class="tone tone3">nǐ</span> <span class="tone tone3">hao</span>');
});

test('pinyinHtml: ü/v normalization in output', () => {
  const html = pinyinBody('lv4 nv3');
  assert.equal(html, '<span class="tone tone4">lü</span> <span class="tone tone3">nü</span>');
});

test('pinyinHtml: all five tones', () => {
  const html = pinyinBody('ma1 ma2 ma3 ma4 ma5');
  assert.match(html, /tone1">ma</);
  assert.match(html, /tone2">ma</);
  assert.match(html, /tone3">ma</);
  assert.match(html, /tone4">ma</);
  assert.match(html, /tone5">ma</);
});

test('pinyinHtml: glued syllable without tone info stays plain', () => {
  assert.equal(pinyinBody('nihao'), 'nihao');
  assert.ok(!pinyinBody('nihao').includes('tone'));
});

test('pinyinHtml: HTML escaping (no raw markup)', () => {
  const html = pinyinBody('<script>ni3</script> hao3');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('ni'));
  assert.ok(html.includes('hao'));

  // quotes and ampersands are escaped too
  assert.equal(pinyinBody('a&b'), 'a&amp;b');
  const q = pinyinBody('"ni3"');
  assert.ok(!q.includes('"ni3"'));
  assert.ok(q.includes('&quot;ni3&quot;'));
});

test('pinyinHtml: wraps output in .py (the hook the pinyin setting hides)', () => {
  assert.ok(pinyinHtml('ni3 hao3').startsWith('<span class="py">'));
  assert.ok(pinyinHtml('ni3 hao3').endsWith('</span>'));
  assert.equal(pinyinHtml(''), '');
});

test('pinyinHtml: empty input returns empty string', () => {
  assert.equal(pinyinBody(''), '');
  assert.equal(pinyinBody('   '), '');
  assert.equal(pinyinBody(null), '');
  assert.equal(pinyinBody(undefined), '');
});

test('pinyinHtml: multiple syllables keep order and spacing', () => {
  const html = pinyinBody('wo3 men2 dou1 shi4 zhong1 guo2 ren2');
  const tones = html.match(/tone\d+/g);
  assert.deepEqual(tones, ['tone3', 'tone2', 'tone1', 'tone4', 'tone1', 'tone2', 'tone2']);
  assert.equal((html.match(/<span /g) || []).length, 7);
});

test('pinyinHtml: capital letters', () => {
  const html = pinyinBody('Ni3 Hao3');
  assert.equal(html, '<span class="tone tone3">Ni</span> <span class="tone tone3">Hao</span>');
});

// --- toggle off -------------------------------------------------------------

test('isToneColorsOn: defaults to true', () => {
  setToneColors(true);
  assert.equal(isToneColorsOn(), true);
});

test('toggle off: pinyinHtml returns plain escaped text (no colors)', () => {
  setToneColors(false);
  assert.equal(isToneColorsOn(), false);
  assert.equal(pinyinBody('ni3 hao3'), 'ni3 hao3');
  assert.equal(pinyinBody('nǐ hǎo'), 'nǐ hǎo');
  assert.ok(!pinyinBody('ni3 hao3').includes('tone'));
  // still escaped while off
  assert.equal(pinyinBody('<b>'), '&lt;b&gt;');

  setToneColors(true);
  assert.equal(isToneColorsOn(), true);
  assert.match(pinyinBody('ni3'), /tone3/);
});

test('setToneColors: treats any non-false value as on', () => {
  setToneColors(undefined);
  assert.equal(isToneColorsOn(), true);
  setToneColors(false);
  assert.equal(isToneColorsOn(), false);
  setToneColors(true);
  assert.equal(isToneColorsOn(), true);
});
