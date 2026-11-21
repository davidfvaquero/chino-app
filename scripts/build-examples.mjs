// scripts/build-examples.mjs
//
// Example sentences for the dictionary: for every simplified word in the
// dictionary (public/data/dict) pick up to 4 short Tatoeba sentences that
// contain that word as a WORD (greedy longest-match segmentation against the
// dictionary itself, so a word is never counted inside a longer word).
//
// Output: public/data/examples/ — small shards keyed by the word, plus an
// index.json describing the hash scheme. This data is NOT precached by the
// service worker: like public/data/dict it loads on demand and is kept in the
// runtime cache (see scripts/lib/shell-assets.mjs and tests/examples-data.test.mjs).
//
// Sources (official Tatoeba exports, CC BY 2.0 FR):
//   per_language/cmn/cmn_sentences.tsv.bz2   Mandarin sentences
//   per_language/eng/eng_sentences.tsv.bz2   English translations
//   per_language/spa/spa_sentences.tsv.bz2   Spanish translations
//   per_language/cmn/cmn-eng_links.tsv.bz2   cmn -> eng translation links
//   per_language/cmn/cmn-spa_links.tsv.bz2   cmn -> spa translation links
//   per_language/eng/eng-spa_links.tsv.bz2   eng -> spa translation links
//
// Usage:
//   node scripts/build-examples.mjs             (npm run data:examples) — downloads + writes
//   node scripts/build-examples.mjs --dry-run   no network, no write (needs the cache)
//
// Raw downloads are cached in data-work/examples/ (git-ignored). The dictionary
// word order puts HSK 1-6 first, then the most frequent corpus words, so a size
// cap always keeps the most useful words.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildTradSimpMap, toSimplified } from './lib/trad-simp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const RAW = path.join(ROOT, 'data-work', 'examples');  // raw downloads (git-ignored)
const OUT = path.join(DATA, 'examples');               // committed output
const DRY = process.argv.includes('--dry-run');
const FORCE = process.env.FORCE === '1';

// Tatoeba only ships an author/username in `sentences_detailed` (305 MB); the
// per-language exports we use are `id\tlang\ttext`, so we keep the sentence id
// (the attribution anchor) and no author.
const SOURCES = {
  cmnSentences: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
  engSentences: 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
  spaSentences: 'https://downloads.tatoeba.org/exports/per_language/spa/spa_sentences.tsv.bz2',
  cmnEngLinks: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2',
  cmnSpaLinks: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-spa_links.tsv.bz2',
  engSpaLinks: 'https://downloads.tatoeba.org/exports/per_language/eng/eng-spa_links.tsv.bz2',
};

const MIN_CHARS = 5;          // sentence length window (chars, punctuation included)
const MAX_CHARS = 25;
const MAX_PER_WORD = 4;       // sentences kept per word
const CAND_PER_WORD = 12;     // candidate sentences scored per word (bounded memory)
const SHARDS = 64;            // word -> shard by hash
const MAX_SHARD_BYTES = 150 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const TARGET_TOTAL_BYTES = Math.floor(MAX_TOTAL_BYTES * 0.94); // keep headroom under the cap
const MAX_WORD_LEN = 8;       // longest dictionary word considered for segmentation

// Simple reject list: if a sentence contains one of these, drop it. Kept short
// and conservative so normal words are never lost.
const OFFENSIVE = [
  '操你', '操我', '干你', '他妈的', '妈的逼', '妈的', '死妈', '傻逼', '傻B', '傻b',
  '贱人', '贱货', '婊子', '妓女', '嫖', '强奸', '做爱', '性交', '鸡巴', '屌',
  '混蛋', '王八蛋', '狗娘', '狗屎', '滚你', '去死', '自杀', '阴道', '阴茎', '奶子',
];

const log = (...a) => console.log(...a);
const pad3 = (n) => String(n).padStart(3, '0');
const hanzi = (ch) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj) + '\n');
  return Buffer.byteLength(JSON.stringify(obj) + '\n');
}

/** Download `url` to `data-work/examples/<name>` unless cached. Never downloads in --dry-run. */
async function cached(url, name) {
  ensureDir(RAW);
  const dest = path.join(RAW, name);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  if (DRY) throw new Error(`--dry-run: missing cache ${name} (run without --dry-run once)`);
  log('  download', name, '<-', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** Stream lines from a .bz2 file using the system bunzip2 (no node dep). */
async function forEachBz2Line(file, cb) {
  const proc = spawn('bunzip2', ['-kc', file]);
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  for await (const line of rl) cb(line);
  await new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 || code === null ? resolve() : reject(new Error('bunzip2 exit ' + code))));
  });
}

/** `id\tcmn\ttext` -> [id, text] for the third column; null when malformed. */
function parseSentenceLine(line) {
  const i = line.indexOf('\t'); if (i < 0) return null;
  const j = line.indexOf('\t', i + 1); if (j < 0) return null;
  return [line.slice(0, i), line.slice(j + 1)];
}

/** `a\tb` -> [a, b] for the two-column link tables. */
function parseLinkLine(line) {
  const t = line.indexOf('\t'); if (t < 0) return null;
  return [line.slice(0, t), line.slice(t + 1)];
}

/** Deterministic shard id for a word (sum of code points weighted by position). */
function shardOf(word, shards) {
  let h = 0;
  let i = 0;
  for (const ch of word) { h = (h + ch.codePointAt(0) * (i + 1)) % 1073741824; i++; }
  return h % shards;
}

const isOffensive = (zh) => OFFENSIVE.some((bad) => zh.includes(bad));

/** Greedy longest-match segmentation of `text` against `wordSet`; returns words only. */
function segment(text, wordSet) {
  const out = [];
  for (let i = 0; i < text.length;) {
    if (!hanzi(text[i])) { i += 1; continue; }
    let matched = null;
    for (let len = Math.min(MAX_WORD_LEN, text.length - i); len >= 1; len--) {
      const cand = text.slice(i, i + len);
      if (wordSet.has(cand)) { matched = cand; break; }
    }
    if (matched) { out.push(matched); i += matched.length; }
    else i += 1;
  }
  return out;
}

/** Pinyin for a sentence — same greedy routine as scripts/build-data.mjs. */
function makeSentencePinyin(sentence, wordPinyin, maxWordLen) {
  const out = [];
  let i = 0;
  while (i < sentence.length) {
    let matched = 0;
    for (let j = Math.min(maxWordLen, sentence.length - i); j >= 1; j--) {
      const w = sentence.slice(i, i + j);
      if (wordPinyin.has(w)) { out.push(wordPinyin.get(w)); i += j; matched = j; break; }
    }
    if (!matched) i += 1;
  }
  return out.join(' ');
}

async function main() {
  const t0 = Date.now();

  // ---- dictionary: entries, word set, pinyin (same heuristic as build-data) --
  const dictManifest = JSON.parse(fs.readFileSync(path.join(DATA, 'dict', 'manifest.json'), 'utf8'));
  const dictEntries = [];
  for (const file of dictManifest.shardFiles) {
    dictEntries.push(...JSON.parse(fs.readFileSync(path.join(DATA, 'dict', file), 'utf8')));
  }
  const tradSimp = buildTradSimpMap(dictEntries);

  const NEUTRAL_PARTICLES = new Set('了的吗呢吧啊呀着得地过们子头嘛哦哎'.split(''));
  const wordSet = new Set();
  for (const e of dictEntries) if (e.simp) wordSet.add(e.simp);
  // Same scoring as build-data.mjs: demote "variant of"/"surname"/archaic glosses,
  // promote the neutral-tone reading of common particles and HSK vocabulary (the
  // shard entry carries its `hsk` level), so 胖 -> pàng and 为 -> wèi.
  const scoreOf = (e) => {
    let sc = 0;
    const d0 = (e.defs[0] || '').toLowerCase();
    if (/^(variant of|old variant|surname|see |archaic|abbr\.|used in)/.test(d0)) sc += 100;
    if ([...e.simp].length === 1 && NEUTRAL_PARTICLES.has(e.simp) && /5$/.test(e.pinyinNumeric)) sc -= 50;
    if (e.hsk) sc -= 20;
    return sc;
  };
  const wordPinyin = new Map();
  const wordScore = new Map();
  let maxWordLen = 1;
  const consider = (w, e) => {
    if (!w || w.length > MAX_WORD_LEN) return;
    if (w.length > maxWordLen) maxWordLen = Math.min(MAX_WORD_LEN, w.length);
    const sc = scoreOf(e);
    if (!wordPinyin.has(w) || sc < wordScore.get(w)) { wordPinyin.set(w, e.pinyin); wordScore.set(w, sc); }
  };
  // Both forms: pinyin is generated from the ORIGINAL (possibly traditional) text.
  for (const e of dictEntries) { consider(e.simp, e); consider(e.trad, e); }
  log(`examples: ${dictEntries.length} dictionary entries, ${wordSet.size} words`);

  // ---- HSK priority (word -> best level 1..6) ------------------------------
  const hskLevel = new Map();
  for (let lvl = 1; lvl <= 6; lvl++) {
    const p = path.join(DATA, 'hsk', `${lvl}.json`);
    if (!fs.existsSync(p)) continue;
    for (const it of JSON.parse(fs.readFileSync(p, 'utf8')).items || []) {
      if (it.hanzi && !hskLevel.has(it.hanzi)) hskLevel.set(it.hanzi, lvl);
    }
  }

  // ---- pass 1: Mandarin sentences -> candidates, char/word frequency --------
  const cmnFile = await cached(SOURCES.cmnSentences, 'cmn_sentences.tsv.bz2');
  const wordIndex = new Map();   // word -> [sentenceId] (<= CAND_PER_WORD, first seen)
  const wordFreq = new Map();    // word -> occurrences in the corpus
  const charFreq = new Map();    // hanzi -> occurrences
  const keepText = new Map();    // sentenceId -> original text (mixed trad/simp)
  let kept = 0;
  await forEachBz2Line(cmnFile, (line) => {
    const parsed = parseSentenceLine(line); if (!parsed) return;
    const [id, text] = parsed;
    const len = [...text].length;
    if (len < MIN_CHARS || len > MAX_CHARS) return;
    if (isOffensive(text)) return;
    kept++;
    const simp = toSimplified(text, tradSimp);
    keepText.set(id, text);
    for (const ch of simp) if (hanzi(ch)) charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
    const seen = new Set();
    for (const w of segment(simp, wordSet)) {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      if (seen.has(w)) continue;
      seen.add(w);
      const list = wordIndex.get(w);
      if (list) { if (list.length < CAND_PER_WORD) { list.push(id); } }
      else wordIndex.set(w, [id]);
    }
  });
  log(`examples: ${kept} candidate sentences (${MIN_CHARS}-${MAX_CHARS} chars), ${wordIndex.size} words seen`);

  // ---- pass 2: translations for the candidate sentences --------------------
  const candIds = new Set();
  for (const list of wordIndex.values()) for (const id of list) candIds.add(id);

  const cmnEngFile = await cached(SOURCES.cmnEngLinks, 'cmn-eng_links.tsv.bz2');
  const engByCmn = new Map();
  const needEng = new Set();
  await forEachBz2Line(cmnEngFile, (line) => {
    const p = parseLinkLine(line); if (!p) return;
    const [cmn, eng] = p;
    if (!candIds.has(cmn)) return;
    if (!engByCmn.has(cmn)) engByCmn.set(cmn, []);
    engByCmn.get(cmn).push(eng);
    needEng.add(eng);
  });

  const engText = new Map();
  if (needEng.size) {
    const engFile = await cached(SOURCES.engSentences, 'eng_sentences.tsv.bz2');
    await forEachBz2Line(engFile, (line) => {
      const p = parseSentenceLine(line); if (!p) return;
      if (needEng.has(p[0])) engText.set(p[0], p[1]);
    });
  }

  const cmnSpaFile = await cached(SOURCES.cmnSpaLinks, 'cmn-spa_links.tsv.bz2');
  const spaByCmn = new Map();
  const needSpa = new Set();
  await forEachBz2Line(cmnSpaFile, (line) => {
    const p = parseLinkLine(line); if (!p) return;
    const [cmn, spa] = p;
    if (!candIds.has(cmn)) return;
    if (!spaByCmn.has(cmn)) spaByCmn.set(cmn, []);
    spaByCmn.get(cmn).push(spa);
    needSpa.add(spa);
  });

  // Spanish via the pair's English translation (pivot), like build-sentences-es.
  const engSpaFile = await cached(SOURCES.engSpaLinks, 'eng-spa_links.tsv.bz2');
  const spaByEng = new Map();
  await forEachBz2Line(engSpaFile, (line) => {
    const p = parseLinkLine(line); if (!p) return;
    const [eng, spa] = p;
    if (!needEng.has(eng)) return;       // only English we might actually use
    if (!spaByEng.has(eng)) spaByEng.set(eng, []);
    spaByEng.get(eng).push(spa);
    needSpa.add(spa);
  });

  const spaText = new Map();
  if (needSpa.size) {
    const spaFile = await cached(SOURCES.spaSentences, 'spa_sentences.tsv.bz2');
    await forEachBz2Line(spaFile, (line) => {
      const p = parseSentenceLine(line); if (!p) return;
      if (needSpa.has(p[0])) spaText.set(p[0], p[1]);
    });
  }
  log(`examples: translations — ${needEng.size} eng, ${needSpa.size} spa candidates`);

  const engOf = (cmn) => { for (const e of engByCmn.get(cmn) || []) { const t = engText.get(e); if (t) return { id: e, text: t }; } return null; };
  const spaOf = (cmn, engIds) => {
    for (const s of spaByCmn.get(cmn) || []) { const t = spaText.get(s); if (t) return t; }
    for (const e of engIds) for (const s of spaByEng.get(e) || []) { const t = spaText.get(s); if (t) return t; }
    return null;
  };

  // ---- pass 3: rank candidates per word, keep up to MAX_PER_WORD ------------
  const entriesByWord = new Map(); // word -> [{id, zh, pinyin, en, es?}]
  for (const [word, ids] of wordIndex) {
    const cands = [];
    for (const id of ids) {
      const text = keepText.get(id);
      const eng = engOf(id);
      if (!text || !eng) continue;                 // schema requires an English field
      const simp = toSimplified(text, tradSimp);
      let fsum = 0, fcount = 0;
      for (const ch of simp) if (hanzi(ch)) { fsum += charFreq.get(ch) || 0; fcount++; }
      const es = spaOf(id, engByCmn.get(id) || []);
      cands.push({ id: Number(id), text, simp, en: eng.text, es, charScore: fcount ? fsum / fcount : 0, len: [...text].length });
    }
    if (!cands.length) continue;
    cands.sort((a, b) =>
      (b.es ? 1 : 0) - (a.es ? 1 : 0) ||
      b.charScore - a.charScore ||
      a.len - b.len ||
      a.id - b.id);
    const picked = [];
    const seenZh = new Set();
    for (const c of cands) {
      if (seenZh.has(c.simp)) continue;
      seenZh.add(c.simp);
      const entry = { id: c.id, zh: c.simp, pinyin: makeSentencePinyin(c.text, wordPinyin, maxWordLen), en: c.en };
      if (c.es) entry.es = c.es;
      picked.push(entry);
      if (picked.length >= MAX_PER_WORD) break;
    }
    if (picked.length) entriesByWord.set(word, picked);
  }
  log(`examples: ${entriesByWord.size} words with examples`);

  // ---- order by priority (HSK 1-6 first, then corpus frequency) -------------
  const words = [...entriesByWord.keys()];
  words.sort((a, b) => {
    const la = hskLevel.get(a) || 99, lb = hskLevel.get(b) || 99;
    return la - lb || (wordFreq.get(b) || 0) - (wordFreq.get(a) || 0) || (a < b ? -1 : a > b ? 1 : 0);
  });

  // ---- size cap: greedy by priority ----------------------------------------
  const sizeOf = (w) => Buffer.byteLength(JSON.stringify(w)) + Buffer.byteLength(JSON.stringify(entriesByWord.get(w)));
  let total = 0;
  const keptWords = [];
  for (const w of words) {
    const s = sizeOf(w);
    if (total + s > TARGET_TOTAL_BYTES) break;
    total += s;
    keptWords.push(w);
  }
  log(`examples: keeping ${keptWords.length}/${words.length} words (~${(total / 1048576).toFixed(2)}MB)`);

  // ---- shard and write -----------------------------------------------------
  const buckets = Array.from({ length: SHARDS }, () => ({}));
  for (const w of keptWords) buckets[shardOf(w, SHARDS)][w] = entriesByWord.get(w);

  const shardFiles = [];
  let written = 0;
  let maxBytes = 0;
  if (!DRY) fs.rmSync(OUT, { recursive: true, force: true });
  buckets.forEach((bucket, i) => {
    const wordsInShard = Object.keys(bucket);
    if (!wordsInShard.length) return;
    const bytes = Buffer.byteLength(JSON.stringify(bucket) + '\n');
    maxBytes = Math.max(maxBytes, bytes);
    written += bytes;
    shardFiles.push({ file: `shards/${pad3(i)}.json`, words: wordsInShard.length, bytes });
    if (!DRY) writeJson(path.join(OUT, 'shards', `${pad3(i)}.json`), bucket);
  });

  const index = {
    source: {
      name: 'Tatoeba cmn/eng/spa sentences',
      url: 'https://downloads.tatoeba.org/exports/',
      license: 'CC BY 2.0 FR',
      homepage: 'https://tatoeba.org',
    },
    license: 'CC BY 2.0 FR',
    note: 'Example sentences for the dictionary: for each simplified word, up to 4 Tatoeba ' +
      'sentences (5-25 chars) that contain the word as a WORD (greedy longest-match ' +
      'segmentation against CC-CEDICT). Pinyin generated from CC-CEDICT. `id` is the Tatoeba ' +
      'sentence id (attribution); `en` is required, `es` is the free Spanish translation when ' +
      'one is linked. Not precached by the service worker: loaded on demand.',
    words: keptWords.length,
    sentences: keptWords.reduce((s, w) => s + entriesByWord.get(w).length, 0),
    shards: SHARDS,
    shardCount: shardFiles.length,
    shardScheme: `word -> shards/NNN.json by sum(codepoint*(position+1)) % ${SHARDS}`,
    maxShardBytes: maxBytes,
    totalBytes: written,
    shardFiles,
  };
  if (!DRY) writeJson(path.join(OUT, 'index.json'), index);

  log(`examples: ${keptWords.length} words, ${index.sentences} sentences, ${shardFiles.length} shards, ` +
    `${(written / 1048576).toFixed(2)}MB (max shard ${(maxBytes / 1024).toFixed(0)}KB)${DRY ? ' [dry-run]' : ''}`);
  log(JSON.stringify({ words: keptWords.length, sentences: index.sentences, shards: shardFiles.length, mb: +(written / 1048576).toFixed(2), maxShardKb: Math.round(maxBytes / 1024), dry: DRY }));
  if (maxBytes > MAX_SHARD_BYTES) throw new Error(`shard too big: ${maxBytes} > ${MAX_SHARD_BYTES}`);
  if (written > MAX_TOTAL_BYTES) throw new Error(`total too big: ${written} > ${MAX_TOTAL_BYTES}`);
  log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => { console.error('build-examples failed:', err); process.exit(1); });
