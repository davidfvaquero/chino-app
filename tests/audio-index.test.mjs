// tests/audio-index.test.mjs
// The pre-generated Mandarin audio (public/audio/): the index must be a valid
// flat { text -> file } map and every entry must point at a real, non-empty
// file. Also checks the coverage we promised (HSK 1-3 words, lesson example
// sentences, theme words/phrases) and the size budget.
//
// Pure Node, no browser, no network: `node --test tests/audio-index.test.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'public', 'audio');
const DATA = path.join(ROOT, 'public', 'data');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const index = read(path.join(AUDIO, 'index.json'));
const entries = Object.entries(index);

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const FILE_NAME = /^[0-9a-f]{16}\.mp3$/;

// Every Chinese text the app can speak, as collected by scripts/build-audio.py.
function expectedTexts() {
  const texts = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.trim() && CJK.test(v)) texts.add(v.trim());
  };
  for (const level of [1, 2, 3]) {
    const file = path.join(DATA, 'hsk', `${level}.json`);
    if (!fs.existsSync(file)) continue;
    for (const item of read(file).items || []) add(item.hanzi);
  }
  for (const area of ['hsk1', 'hsk2', 'practical']) {
    const dir = path.join(DATA, 'lessons', area);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => /^lesson-.*\.json$/.test(f))) {
      for (const entry of read(path.join(dir, name)).vocabulary || []) add((entry.example || {}).hanzi);
    }
  }
  const themes = path.join(DATA, 'themes');
  for (const name of fs.readdirSync(themes).filter((f) => /^theme-.*\.json$/.test(f))) {
    const theme = read(path.join(themes, name));
    for (const key of ['words', 'phrases']) for (const entry of theme[key] || []) add(entry.hanzi);
  }
  return texts;
}

test('index.json is a non-empty flat { text -> file } map', () => {
  assert.ok(entries.length > 900, `expected a big index, got ${entries.length}`);
  for (const [text, file] of entries) {
    assert.ok(typeof text === 'string' && text.trim().length > 0, 'empty key');
    assert.ok(CJK.test(text), `key is not Chinese: ${JSON.stringify(text)}`);
    assert.equal(typeof file, 'string');
    assert.match(file, FILE_NAME, `bad file name for ${JSON.stringify(text)}`);
    // Bare file name relative to index.json's own directory: no path, no leading slash.
    assert.ok(!file.includes('/'), `file name must not contain a path: ${file}`);
  }
});

test('every index entry points at an existing, non-empty file', () => {
  for (const [text, file] of entries) {
    const full = path.join(AUDIO, file);
    assert.ok(fs.existsSync(full), `missing file for ${JSON.stringify(text)}: ${file}`);
    assert.ok(fs.statSync(full).size > 0, `empty file for ${JSON.stringify(text)}: ${file}`);
  }
});

test('no two texts share a file and no file is orphaned', () => {
  const byFile = new Map();
  for (const [text, file] of entries) {
    assert.ok(!byFile.has(file), `hash collision: ${text} and ${byFile.get(file)} -> ${file}`);
    byFile.set(file, text);
  }
  const onDisk = fs.readdirSync(AUDIO).filter((f) => f.endsWith('.mp3'));
  const orphans = onDisk.filter((f) => !byFile.has(f));
  assert.deepEqual(orphans, [], `audio files not in the index: ${orphans.slice(0, 5).join(', ')}`);
  assert.equal(onDisk.length, byFile.size);
});

test('covers the texts the app shows (HSK 1-3, lesson examples, themes)', () => {
  const missing = [...expectedTexts()].filter((t) => !(t in index));
  // A handful of texts may have nothing speakable (e.g. only Latin letters).
  assert.ok(missing.length <= 5, `not covered: ${missing.slice(0, 10).join(' | ')}`);
});

test('stays inside the size budget and the index stays small', () => {
  let bytes = 0;
  for (const file of fs.readdirSync(AUDIO)) {
    if (file.endsWith('.mp3')) bytes += fs.statSync(path.join(AUDIO, file)).size;
  }
  const mb = bytes / 1024 / 1024;
  assert.ok(mb < 60, `audio total ${mb.toFixed(1)} MB exceeds the 60 MB budget`);
  const indexKb = fs.statSync(path.join(AUDIO, 'index.json')).size / 1024;
  assert.ok(indexKb < 300, `index.json is ${indexKb.toFixed(0)} KB, too heavy for mobile`);
});
