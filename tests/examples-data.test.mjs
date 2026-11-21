// tests/examples-data.test.mjs
// Derived from the committed data after `node scripts/build-examples.mjs`:
//   words with examples: 13443
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
// context (行 xíng/háng, 还 hái/huán, 长, 重, 都). Two words escape that ceiling
// via a short pinned list (FORCED_READING): 了解 (liǎo jiě — "不了" would eat the
// 了, giving "le jiě") and 这儿/那儿 (CC-CEDICT neutralises the base in the
// compounds 在那儿/我这儿, giving "nar"/"zher"; the pinned reading keeps zhèr/nàr).
// The aspect particle 了 reads 'le': a CC-CEDICT word that only starts or ends in
// 了 (到了 "at last", 了事, 知了 "cicada") must not force 'liǎo'. The only 'liǎo'
// readings kept are the documented LIAO_WORDS list and the V不了 / V得了 pattern.
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

// Regression: the greedy segmenter used to render 这儿/那儿 without a tone
// ("zher"/"nar") because CC-CEDICT neutralises 这/那 in the compounds 在那儿
// (zai4 na5 r5) and 我这儿 (wo3 zhe5 r5), and rendered 了解 as "le jiě" because
// "不了" (bù le) stole the 了. Both are pinned in FORCED_READING; this test dies
// if that fix is reverted (the committed data would carry the toneless forms).
test('这儿/那儿 keep their tone and 了解 is liǎo jiě (no toneless forms)', () => {
  let erhua = 0;
  let liaojie = 0;
  for (const { file, words: bucket } of shards) {
    for (const [word, list] of Object.entries(bucket)) {
      for (const e of list) {
        const pinyin = e.pinyin.toLowerCase();   // first syllable is capitalised
        const tokens = pinyin.split(' ');
        if (e.zh.includes('这儿') || e.zh.includes('那儿')) {
          erhua += 1;
          assert.ok(!tokens.includes('zher') && !tokens.includes('nar'),
            `${file} ${word}: toneless erhua in "${e.pinyin}" ("${e.zh}")`);
          assert.ok(!pinyin.includes('zhe r') && !pinyin.includes('na r'),
            `${file} ${word}: detached toneless r in "${e.pinyin}" ("${e.zh}")`);
          if (e.zh.includes('这儿')) assert.ok(pinyin.includes('zhèr'), `${file} ${word}: "${e.zh}" -> "${e.pinyin}" (want zhèr)`);
          if (e.zh.includes('那儿')) assert.ok(pinyin.includes('nàr'), `${file} ${word}: "${e.zh}" -> "${e.pinyin}" (want nàr)`);
        }
        if (e.zh.includes('了解')) {
          liaojie += 1;
          assert.ok(!pinyin.includes('le jiě'), `${file} ${word}: "le jiě" in "${e.zh}" -> "${e.pinyin}"`);
          assert.ok(pinyin.includes('liǎo jiě'), `${file} ${word}: "${e.zh}" -> "${e.pinyin}" (want liǎo jiě)`);
        }
      }
    }
  }
  assert.ok(erhua > 0, `the dataset still exercises 这儿/那儿 (found ${erhua})`);
  assert.ok(liaojie > 0, `the dataset still exercises 了解 (found ${liaojie})`);
});

// Regression: CC-CEDICT carries compounds that only start or end in 了 with a
// 'liǎo' reading (到了 "at last", 了事, 知了 "cicada"), and the greedy longest-match
// used to pick them, rendering the aspect particle 了 as 'liǎo' ("dào liǎo",
// "liǎo shì", "zhī liǎo"). makeSentencePinyin now rejects a 了-edge word unless it
// is a documented whole-word reading (LIAO_WORDS / V不了 / V得了). This test dies if
// that fix is reverted: the committed data would carry "dào liǎo" again.
test('particle 了 reads le, not liǎo (到了 is dào le, no liǎo shì / zhī liǎo)', () => {
  let daoliao = 0;
  let liaoshi = 0;
  let zhiliao = 0;
  let daole = 0;
  let liaojie = 0;
  let legit = 0;   // legitimate liǎo readings that must survive
  for (const { file, words: bucket } of shards) {
    for (const [word, list] of Object.entries(bucket)) {
      for (const e of list) {
        const pinyin = e.pinyin.toLowerCase();
        if (pinyin.includes('dào liǎo')) daoliao += 1;
        if (pinyin.includes('zhī liǎo')) zhiliao += 1;
        if (/(事故|事实|事业)/.test(e.zh) && pinyin.includes('liǎo shì')) liaoshi += 1;
        if (e.zh.includes('到了')) {
          daole += 1;
          assert.ok(!pinyin.includes('dào liǎo'), `${file} ${word}: "dào liǎo" in "${e.zh}" -> "${e.pinyin}"`);
        }
        if (e.zh.includes('了解')) {
          liaojie += 1;
          assert.ok(pinyin.includes('liǎo jiě'), `${file} ${word}: 了解 is not liǎo jiě in "${e.zh}" -> "${e.pinyin}"`);
        }
        if (/(了不起|受不了|来不了|吃不了)/.test(e.zh)) {
          legit += 1;
          assert.ok(pinyin.includes('liǎo'), `${file} ${word}: legit liǎo lost in "${e.zh}" -> "${e.pinyin}"`);
        }
      }
    }
  }
  assert.equal(daoliao, 0, `"dào liǎo" entries left: ${daoliao}`);
  assert.equal(zhiliao, 0, `"zhī liǎo" entries left: ${zhiliao}`);
  assert.equal(liaoshi, 0, `"liǎo shì" entries left: ${liaoshi}`);
  assert.ok(daole > 0, `the dataset still exercises 到了 (found ${daole})`);
  assert.ok(liaojie > 0, `the dataset still exercises 了解 (found ${liaojie})`);
  assert.ok(legit > 0, `the dataset still exercises legit liǎo readings (found ${legit})`);
});

// ------------------------------------------------ REVIEW-7 I3/I4 regressions

const allEntries = () => {
  const out = [];
  for (const { file, words: bucket } of shards) {
    for (const [word, list] of Object.entries(bucket)) {
      for (const e of list) out.push({ file, word, ...e });
    }
  }
  return out;
};

test('I3: greedy false positives are gone (去火/请安/会安/白汤/的哥)', () => {
  const keys = new Set();
  for (const { words: bucket } of shards) for (const word of Object.keys(bucket)) keys.add(word);
  for (const word of ['去火', '请安', '会安', '白汤', '的哥']) {
    assert.ok(!keys.has(word), `${word} is not used as an example key`);
  }
});

test('I3: no sentence with 我的哥哥 reads 的 as dī', () => {
  for (const e of allEntries()) {
    if (!e.zh.includes('我的哥哥')) continue;
    assert.ok(!/dī/.test(e.pinyin), `${e.zh} -> ${e.pinyin}`);
  }
});

test('I4: the simplified text has no 於/乾净 and no Japanese variants', () => {
  for (const e of allEntries()) {
    assert.ok(!e.zh.includes('於'), `${e.file} ${e.word}: ${e.zh} has 於`);
    assert.ok(!e.zh.includes('乾净'), `${e.file} ${e.word}: ${e.zh} has 乾净`);
    for (const ch of ['髪', '顔', '犠', '兿', '貭']) {
      assert.ok(!e.zh.includes(ch), `${e.file} ${e.word}: ${e.zh} has ${ch}`);
    }
  }
});

test('I4: 只 after a numeral reads zhī, and default readings are fixed', () => {
  const NUMERAL = /[一二三四五六七八九十百千万两几这那每]/;
  // 这/那 + 只 + (是|不|有|能|要|会) is the adverb 只 zhǐ (这只是 = zhǐ), not the
  // measure word: skip that case here, it is asserted in its own test below.
  const adverbZhi = (before, after) => /[这那]/.test(before) && /[是不有能要会]/.test(after);
  for (const e of allEntries()) {
    const py = e.pinyin.toLowerCase();
    const hanzi = [...e.zh].filter((ch) => /[\u3400-\u9fff]/.test(ch));
    const tokens = e.pinyin.split(' ');
    if (hanzi.length === tokens.length) {
      for (let i = 0; i < hanzi.length - 1; i += 1) {
        if (NUMERAL.test(hanzi[i]) && hanzi[i + 1] === '只' && !adverbZhi(hanzi[i], hanzi[i + 2] ?? '')) {
          assert.notEqual(tokens[i + 1].toLowerCase(), 'zhǐ',
            `${e.zh} -> ${e.pinyin} (want zhī after ${hanzi[i]})`);
        }
      }
    }
    if (e.zh.includes('一片')) assert.ok(!/yī piān/.test(py), `${e.zh} -> ${e.pinyin} (want piàn)`);
    if (e.zh.includes('之作')) assert.ok(!/zuō/.test(py), `${e.zh} -> ${e.pinyin} (want zuò)`);
    if (e.zh.includes('这趟')) assert.ok(!/tāng/.test(py), `${e.zh} -> ${e.pinyin} (want tàng)`);
    if (e.zh.includes('抢')) assert.ok(!/qiāng/.test(py), `${e.zh} -> ${e.pinyin} (want qiǎng)`);
  }
});

test('I4: 这/那只+(是|不|有|能|要|会) reads 只 as zhǐ (adverb), not zhī', () => {
  let seen = 0;
  for (const e of allEntries()) {
    const hanzi = [...e.zh].filter((ch) => /[\u3400-\u9fff]/.test(ch));
    const tokens = e.pinyin.split(' ');
    if (hanzi.length !== tokens.length) continue;
    for (let i = 0; i + 2 < hanzi.length; i += 1) {
      if (/[这那]/.test(hanzi[i]) && hanzi[i + 1] === '只' && /[是不有能要会]/.test(hanzi[i + 2])) {
        seen += 1;
        assert.equal(tokens[i + 1].toLowerCase(), 'zhǐ',
          `${e.zh} -> ${e.pinyin} (want zhǐ in ${hanzi[i]}只${hanzi[i + 2]})`);
      }
    }
  }
  assert.ok(seen > 0, 'at least one 这/那只+是/不/有/能/要/会 sentence exists in the corpus');
});

test('I4: 著 is never simplified to 着 (no 土着/显着/昭着)', () => {
  for (const e of allEntries()) {
    for (const bad of ['土着', '显着', '昭着']) {
      assert.ok(!e.zh.includes(bad), `${e.file} ${e.word}: ${e.zh} has ${bad}`);
    }
  }
});
