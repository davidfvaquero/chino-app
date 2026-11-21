// tests/examples-data.test.mjs
// Derived from the committed data after `node scripts/build-examples.mjs`:
//   words with examples: 13444
//   total size:          7.55 MB (uncompressed), 64 shards, biggest shard ~142 KB
//   examples of 好 (hǎo):
//     我好胖哦。 — Wǒ hǎo pàng o — "I'm so fat." / "Estoy tan gordo."
//     其他的一切都好。 — Qí tā de yī qiè dōu hǎo — "Everything else is fine."
//     即使他们有很好的酒单，我也不想在这里用餐。 — "Even if they have a good wine menu…"
//     把你的自行车放好。 — "Put your bike away."
//   examples of 银行 (yín háng):
//     我在银行工作。 — Wǒ zài yín háng gōng zuò — "I work in a bank." / "Trabajo en el banco."
//     我不喜欢在银行工作。 — "I don't like working at the bank."
//     这是邮局，那是银行。 — "This is a post office and that is a bank."
//     他银行里有点钱。 — "He has some money in the bank."
//   examples of 因为 (yīn wèi):
//     "你为什么不去？""因为我不想去。" — "Why aren't you going?" "Because I don't want to."
//     如果不是因为有你的帮助，我不可能完成了这个工作。 — "If it had not been for your help…"
//     那是因为你是女生。 — Nà shi yīn wèi nǐ shì nǚ shēng — "That's because you're a girl."
//     因为我想成为翻译。 — Yīn wèi wǒ xiǎng chéng wéi fān yì — "Because I want to be a translator."
//
// Pinyin normalisation (in scripts/build-examples.mjs): only the first syllable
// is capitalised (CC-CEDICT surnames/abbreviations like Měi/Zhōu/Hànyǔ are
// lowercased), erhua "r" is glued to the previous syllable (nà r -> nàr), and
// sentences with latin letters/digits are dropped, as is a trailing ASCII '.'
// (rewritten to 。). Polyphony is a known ceiling: one reading per word, no
// context (行 xíng/háng, 还 hái/huán, 长, 重, 都).
//
// Schema of public/data/examples/shards/NNN.json: { "<word>": [ {id, zh, pinyin, en, es?} ] }
// pinned here: the word is part of every zh, <= 4 sentences per word, the sizes
// stay small, and NO examples file is precached by the service worker (it loads
// on demand, like the dictionary).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isShellAsset } from '../scripts/lib/shell-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const EX = path.join(DATA, 'examples');
const index = JSON.parse(fs.readFileSync(path.join(EX, 'index.json'), 'utf8'));

/** Same hash as scripts/build-examples.mjs: sum(codepoint*(position+1)) % shards. */
function shardOf(word, shards) {
  let h = 0;
  let i = 0;
  for (const ch of word) { h = (h + ch.codePointAt(0) * (i + 1)) % 1073741824; i += 1; }
  return h % shards;
}

/** Every shard, parsed, with its file name. */
function loadShards() {
  const out = [];
  for (let i = 0; i < index.shards; i += 1) {
    const file = `shards/${String(i).padStart(3, '0')}.json`;
    if (!fs.existsSync(path.join(EX, file))) continue;
    out.push({ file, id: i, words: JSON.parse(fs.readFileSync(path.join(EX, file), 'utf8')) });
  }
  return out;
}

const shards = loadShards();

test('index describes a Tatoeba CC BY 2.0 FR dataset with a hash shard scheme', () => {
  assert.equal(index.license, 'CC BY 2.0 FR');
  assert.equal(index.source.license, 'CC BY 2.0 FR');
  assert.match(index.source.url, /downloads\.tatoeba\.org/);
  assert.ok(index.words > 0, 'some words have examples');
  assert.ok(Number.isInteger(index.shards) && index.shards > 0);
  assert.match(index.shardScheme, new RegExp(`% ${index.shards}|\\b${index.shards}\\b`));
});

test('every word lives in the shard its documented hash points to', () => {
  let words = 0;
  for (const { id, words: bucket } of shards) {
    for (const word of Object.keys(bucket)) {
      assert.equal(shardOf(word, index.shards), id, `${word} is in the wrong shard`);
      words += 1;
    }
  }
  assert.equal(words, index.words, 'index.words matches the shards');
});

test('every shard has the {id, zh, pinyin, en, es?} schema, <= 4 per word, word in each zh', () => {
  let sentences = 0;
  for (const { file, words: bucket } of shards) {
    for (const [word, list] of Object.entries(bucket)) {
      assert.ok(Array.isArray(list) && list.length >= 1, `${file} ${word}: non-empty list`);
      assert.ok(list.length <= 4, `${file} ${word}: <= 4 examples (got ${list.length})`);
      const seen = new Set();
      for (const e of list) {
        const keys = Object.keys(e).sort().join(',');
        assert.ok(keys === 'en,id,pinyin,zh' || keys === 'en,es,id,pinyin,zh', `${file} ${word}: keys ${keys}`);
        assert.equal(typeof e.id, 'number');
        assert.ok(e.id > 0);
        assert.equal(typeof e.zh, 'string');
        assert.equal(typeof e.pinyin, 'string');
        assert.equal(typeof e.en, 'string');
        if (e.es !== undefined) assert.equal(typeof e.es, 'string');
        assert.ok(e.zh.includes(word), `"${e.zh}" contains the word ${word}`);
        const len = [...e.zh].length;
        assert.ok(len >= 5 && len <= 25, `"${e.zh}" is 5-25 chars (got ${len})`);
        assert.ok(!seen.has(e.zh), `${file} ${word}: duplicate zh "${e.zh}"`);
        seen.add(e.zh);
        sentences += 1;
      }
    }
  }
  assert.equal(sentences, index.sentences, 'index.sentences matches the shards');
});

test('shards stay small (< 150 KB each) and the dataset is <= 8 MB', () => {
  let total = 0;
  for (const { file } of shards) {
    const bytes = fs.statSync(path.join(EX, file)).size;
    assert.ok(bytes < 150 * 1024, `${file} is ${bytes} bytes (< 150 KB)`);
    total += bytes;
  }
  assert.equal(total, index.totalBytes, 'index.totalBytes matches the shard files');
  assert.ok(total <= 8 * 1024 * 1024, `total ${total} bytes (<= 8 MB)`);
});

test('the whole examples dataset is kept out of the service-worker precache', () => {
  assert.equal(isShellAsset('data/examples/index.json'), false);
  for (const { file } of shards) assert.equal(isShellAsset(`data/examples/${file}`), false);
  assert.equal(isShellAsset('data/examples/shards/000.json'), false);
  // The shell list in build.mjs only ever precaches the small indexes.
  assert.equal(isShellAsset('data/dict/manifest.json'), false);
});
