#!/usr/bin/env node
// ============================================================================
// build-data.mjs — reproducible data pipeline for the chino-app PWA.
// ============================================================================
// Downloads ONLY free/open datasets, processes them into small JSON shards
// under public/data/ so the app can work offline and load lazily on mobile.
// The generated JSON IS meant to be committed (the app must run without net).
//
// Run with:   npm run data        (= node scripts/build-data.mjs)
// Raw downloads are cached in .cache/ (git-ignored) and reused on later runs;
// force a re-download with `FORCE=1 npm run data`.
//
// Output layout (all sizes are for the committed result):
//   public/data/manifest.json            – global index/manifest of everything
//   public/data/dict/manifest.json       – dictionary shard scheme + stats
//   public/data/dict/shards/NNN.json     – CC-CEDICT entries, < ~180KB each
//   public/data/dict/index-hanzi.json    – char -> shard(s) (handles simp+trad)
//   public/data/dict/index-pinyin/x.json – toneless pinyin -> shard(s), by letter
//   public/data/dict/index-english/x.json– english word -> shard(s), by letter
//   public/data/strokes/index.json       – char -> shard + shard ranges
//   public/data/strokes/shards/NNN.json  – {character,strokes,medians} (hanzi-writer compatible)
//   public/data/sentences/{index.json,shards/NNN.json} – short cmn/eng pairs + pinyin
//   public/data/hsk/{index.json,1..6.json}             – HSK vocabulary by level
//
// Sources & licences (see /CREDITS.md for the full attribution text):
//   * CC-CEDICT      – https://www.mdbg.net/chinese/dictionary?page=cc-cedict  (CC BY-SA 4.0)
//   * Make Me a Hanzi– https://github.com/skishore/makemeahanzi                (Arphic PL / LGPL)
//   * Tatoeba        – https://tatoeba.org  cmn/eng sentence pairs             (CC BY 2.0 FR)
//   * HSK word lists – https://github.com/glxxyz/hskhsk.com                    (MIT), official HSK 2.0 lists
//   * No third-party JS dependencies: pure Node stdlib + the system `bunzip2`.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { pinyinToMarks, tonelessKey } from '../src/pinyin.js';
import { buildTradSimpMap, toSimplified } from './lib/trad-simp.mjs';
import { cleanGenerated } from './lib/clean-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '.cache');                 // raw downloads (git-ignored)
const OUT = path.join(ROOT, 'public', 'data');         // committed output
const FORCE = process.env.FORCE === '1';
const MAX_SHARD = 170 * 1024;                          // < 200KB per shard target

// Very common English function words are noise for a word->entry lookup and
// would otherwise blow up the inverted index (they appear in almost every
// definition). They are simply not indexed.
const EN_STOPWORDS = new Set(('a an the and or of to be is are was were am ' +
  'in on at for with it its that this these those as by from if so no not ' +
  'do does did done has have had will would can could should may might must ' +
  'one used also see who which he she they you we i him her them us my your ' +
  'his their our there here when what where how why all any some such etc ' +
  'into out up down over under again more most other another same than then').split(/\s+/));
const SENTENCE_LIMIT = Number(process.env.SENTENCE_LIMIT || 3000);
const MAX_CN_CHARS = 12;                               // keep sentences <= 12 chars

const SOURCES = {
  cedict: {
    name: 'CC-CEDICT',
    url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
    license: 'CC BY-SA 4.0',
    homepage: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
  },
  hanzi: {
    name: 'Make Me a Hanzi',
    url: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/graphics.txt',
    license: 'Arphic Public License (strokes) / LGPL (code)',
    homepage: 'https://github.com/skishore/makemeahanzi',
  },
  tatoebaCmn: {
    name: 'Tatoeba cmn sentences',
    url: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
    license: 'CC BY 2.0 FR',
    homepage: 'https://tatoeba.org',
  },
  tatoebaEng: {
    name: 'Tatoeba eng sentences',
    url: 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
    license: 'CC BY 2.0 FR',
    homepage: 'https://tatoeba.org',
  },
  tatoebaLinks: {
    name: 'Tatoeba cmn-eng links',
    url: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2',
    license: 'CC BY 2.0 FR',
    homepage: 'https://tatoeba.org',
  },
  hsk: {
    name: 'HSK official vocabulary (2012, HSK 2.0) via hskhsk.com',
    url: 'https://raw.githubusercontent.com/glxxyz/hskhsk.com/main/data/lists/HSK%20Official%20With%20Definitions%202012%20L{level}.txt',
    license: 'MIT (list compilation); word lists are the official Hanban HSK vocabulary',
    homepage: 'https://github.com/glxxyz/hskhsk.com',
  },
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const log = (...a) => console.log(...a);
const kb = (n) => (n / 1024).toFixed(1) + 'KB';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  const s = JSON.stringify(obj);
  fs.writeFileSync(file, s + '\n');
  return Buffer.byteLength(s);
}

/** Download `url` to `.cache/<name>` unless already cached (FORCE=1 re-downloads). */
async function cached(url, name) {
  ensureDir(RAW);
  const dest = path.join(RAW, name);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  log('  download', name, '<-', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
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

/** Greedy packing of items into shards whose JSON stays under MAX_SHARD bytes. */
function packSequential(items, maxBytes = MAX_SHARD) {
  const shards = [];
  let cur = [];
  let bytes = 2;
  for (const it of items) {
    const b = Buffer.byteLength(JSON.stringify(it)) + 1;
    if (cur.length && bytes + b > maxBytes) { shards.push(cur); cur = []; bytes = 2; }
    cur.push(it); bytes += b;
  }
  if (cur.length) shards.push(cur);
  return shards;
}

const pad3 = (n) => String(n).padStart(3, '0');

// ---------------------------------------------------------------------------
// 1. CC-CEDICT -> dict/shards + search indices
// ---------------------------------------------------------------------------
function parseCedict(text) {
  const entries = [];
  let id = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line[0] === '#') continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/\s*$/);
    if (!m) continue;
    const [, trad, simp, numPinyin, defsRaw] = m;
    const defs = defsRaw.split('/').map((d) => d.trim()).filter(Boolean);
    if (!defs.length) continue;
    entries.push({
      id: id++,
      simp,
      trad,
      pinyinNumeric: numPinyin.trim(),
      pinyin: pinyinToMarks(numPinyin),   // tone marks
      defs,
    });
  }
  return entries;
}

async function buildDict(entries) {
  log(`dict: ${entries.length} CC-CEDICT entries`);
  const groups = new Map(); // first simplified char -> entries
  for (const e of entries) {
    const c = e.simp[0];
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(e);
  }
  const chars = [...groups.keys()].sort();

  const shards = [];
  const charShards = new Map();   // simplified first char -> Set(shardIdx)
  const tradShards = new Map();   // traditional first char -> Set(shardIdx)
  const pinyinIdx = new Map();    // toneless key -> Set(shardIdx)
  const englishIdx = new Map();   // english word -> Set(shardIdx)

  const add = (map, key, s) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(s); };

  let cur = null;
  const newShard = () => { cur = { entries: [], bytes: 2 }; shards.push(cur); };

  for (const ch of chars) {
    for (const e of groups.get(ch)) {
      const out = { id: e.id, simp: e.simp, trad: e.trad, pinyin: e.pinyin, pinyinNumeric: e.pinyinNumeric, defs: e.defs };
      const b = Buffer.byteLength(JSON.stringify(out)) + 1;
      if (!cur || (cur.entries.length && cur.bytes + b > MAX_SHARD)) newShard();
      const s = shards.length - 1;
      cur.entries.push(out);
      cur.bytes += b;
      add(charShards, ch, s);
      add(tradShards, e.trad[0], s);
      const pk = tonelessKey(e.pinyinNumeric);
      if (pk) add(pinyinIdx, pk, s);
      for (const d of e.defs) {
        const words = d.toLowerCase().match(/[a-z][a-z'-]*/g);
        if (!words) continue;
        for (const w of words) if (w.length >= 2 && !EN_STOPWORDS.has(w)) add(englishIdx, w, s);
      }
    }
  }

  // write shards (strip internal fields)
  const dir = path.join(OUT, 'dict', 'shards');
  let total = 0;
  shards.forEach((sh, i) => {
    total += writeJson(path.join(dir, `${pad3(i)}.json`), sh.entries);
  });

  // hanzi index: first char -> shard list. Split simp/trad so a mobile client
  // only downloads the tiny file it needs for the search it is doing.
  const simpMap = {}, tradMap = {};
  for (const [c, set] of [...charShards].sort()) simpMap[c] = [...set].sort((a, b) => a - b);
  for (const [c, set] of [...tradShards].sort()) tradMap[c] = [...set].sort((a, b) => a - b);
  writeJson(path.join(OUT, 'dict', 'index-hanzi.json'), { type: 'simplified', chars: simpMap });
  writeJson(path.join(OUT, 'dict', 'index-hanzi-trad.json'), { type: 'traditional', chars: tradMap });

  // pinyin + english indices split by first letter for lazy loading
  const writeLetterIndex = (map, subdir) => {
    const byLetter = new Map();
    for (const [k, set] of map) {
      const letter = /^[a-z]/.test(k) ? k[0] : '_';
      if (!byLetter.has(letter)) byLetter.set(letter, {});
      byLetter.get(letter)[k] = [...set].sort((a, b) => a - b);
    }
    for (const [letter, obj] of byLetter) {
      writeJson(path.join(OUT, 'dict', subdir, `${letter}.json`), obj);
    }
    return byLetter.size;
  };
  const pnFiles = writeLetterIndex(pinyinIdx, 'index-pinyin');
  const enFiles = writeLetterIndex(englishIdx, 'index-english');

  const manifest = {
    source: SOURCES.cedict,
    entries: entries.length,
    shards: shards.length,
    maxShardBytes: Math.max(...shards.map((s) => Buffer.byteLength(JSON.stringify(s.entries)))),
    index: {
      hanzi: 'index-hanzi.json (simplified first char -> shards)',
      hanziTrad: 'index-hanzi-trad.json (traditional first char -> shards)',
      pinyin: `index-pinyin/<letter>.json (${pnFiles} files)`,
      english: `index-english/<letter>.json (${enFiles} files)`,
      englishStopwords: [...EN_STOPWORDS],
    },
    shardScheme: 'entries grouped by first simplified hanzi; each shard < ~170KB; index maps char/word -> shard id',
    shardFiles: shards.map((_, i) => `shards/${pad3(i)}.json`),
  };
  writeJson(path.join(OUT, 'dict', 'manifest.json'), manifest);
  log(`dict: ${shards.length} shards, ${kb(total)} total, pinyin ${pinyinIdx.size} keys, english ${englishIdx.size} words`);
  return { entries, shards, total, manifest, pinyinIdx, englishIdx };
}

// ---------------------------------------------------------------------------
// 2. Make Me a Hanzi -> strokes shards (hanzi-writer compatible)
// ---------------------------------------------------------------------------
async function buildStrokes() {
  const file = await cached(SOURCES.hanzi.url, 'graphics.txt');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const chars = [];
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || !o.character) continue;
    chars.push({ character: o.character, strokes: o.strokes || [], medians: o.medians || [] });
  }
  chars.sort((a, b) => (a.character < b.character ? -1 : a.character > b.character ? 1 : 0));

  const shards = packSequential(chars);
  const lookup = {};
  let total = 0;
  shards.forEach((sh, i) => {
    total += writeJson(path.join(OUT, 'strokes', 'shards', `${pad3(i)}.json`), sh);
    for (const c of sh) lookup[c.character] = i;
  });
  const meta = {
    source: SOURCES.hanzi,
    characters: chars.length,
    shards: shards.length,
    format: 'hanzi-writer compatible: each entry {character, strokes:[svgPath...], medians:[[[x,y],...]]}',
    maxShardBytes: Math.max(...shards.map((s) => Buffer.byteLength(JSON.stringify(s)))),
    lookup, // character -> shard index; load strokes/shards/NNN.json then find it
    shardFiles: shards.map((_, i) => `shards/${pad3(i)}.json`),
  };
  writeJson(path.join(OUT, 'strokes', 'index.json'), meta);
  log(`strokes: ${chars.length} characters, ${shards.length} shards, ${kb(total)} total`);
  return { chars, shards, total, meta };
}

// ---------------------------------------------------------------------------
// 3. Tatoeba cmn-eng -> short sentence pairs with generated pinyin
// ---------------------------------------------------------------------------
function makeSentencePinyin(sentence, wordPinyin, maxWordLen) {
  const out = [];
  let i = 0;
  while (i < sentence.length) {
    let matched = 0;
    for (let j = Math.min(maxWordLen, sentence.length - i); j >= 1; j--) {
      const w = sentence.slice(i, i + j);
      if (wordPinyin.has(w)) { out.push(wordPinyin.get(w)); i += j; matched = j; break; }
    }
    if (!matched) i += 1; // unknown char (punctuation / rare hanzi): skip
  }
  return out.join(' ');
}

async function buildSentences(dictEntries) {
  const cmnFile = await cached(SOURCES.tatoebaCmn.url, 'cmn_sentences.tsv.bz2');
  const engFile = await cached(SOURCES.tatoebaEng.url, 'eng_sentences.tsv.bz2');
  const linkFile = await cached(SOURCES.tatoebaLinks.url, 'cmn-eng_links.tsv.bz2');

  // 1) keep short Mandarin sentences
  const cmnText = new Map();
  await forEachBz2Line(cmnFile, (line) => {
    const i = line.indexOf('\t'); if (i < 0) return;
    const j = line.indexOf('\t', i + 1); if (j < 0) return;
    const id = line.slice(0, i);
    const text = line.slice(j + 1);
    if ([...text].length <= MAX_CN_CHARS) cmnText.set(id, text);
  });

  // 2) cmn id -> eng ids (only for kept sentences)
  const engIdsByCmn = new Map();
  const neededEng = new Set();
  await forEachBz2Line(linkFile, (line) => {
    const t = line.indexOf('\t'); if (t < 0) return;
    const cmn = line.slice(0, t), eng = line.slice(t + 1);
    if (!cmnText.has(cmn)) return;
    if (!engIdsByCmn.has(cmn)) engIdsByCmn.set(cmn, []);
    engIdsByCmn.get(cmn).push(eng);
    neededEng.add(eng);
  });

  // 3) translations we actually need
  const engText = new Map();
  await forEachBz2Line(engFile, (line) => {
    const i = line.indexOf('\t'); if (i < 0) return;
    const j = line.indexOf('\t', i + 1); if (j < 0) return;
    const id = line.slice(0, i);
    if (neededEng.has(id)) engText.set(id, line.slice(j + 1));
  });

  // 4) assemble, prefer shorter sentences, deterministic
  // Build word->pinyin from CC-CEDICT. A word can have several entries; prefer
  // the first (primary) reading, but demote "variant of"/"surname"/"archaic"
  // glosses and promote the neutral-tone reading of common particles
  // (了/的/吗/…). Full disambiguation would need a corpus-driven segmenter;
  // this is a documented, deterministic approximation.
  const NEUTRAL_PARTICLES = new Set('了的吗呢吧啊呀着得地过们子头嘛哦哎'.split(''));
  const scoreOf = (e) => {
    let sc = 0;
    const d0 = (e.defs[0] || '').toLowerCase();
    if (/^(variant of|old variant|surname|see |archaic|abbr\.|used in)/.test(d0)) sc += 100;
    if (e.simp.length === 1 && NEUTRAL_PARTICLES.has(e.simp) && /5$/.test(e.pinyinNumeric)) sc -= 50;
    return sc;
  };
  const wordPinyin = new Map();
  const wordScore = new Map();
  let maxWordLen = 1;
  const consider = (w, e) => {
    if (!w || w.length > 8) return;
    if (w.length > maxWordLen) maxWordLen = Math.min(8, w.length);
    const sc = scoreOf(e);
    if (!wordPinyin.has(w) || sc < wordScore.get(w)) { wordPinyin.set(w, e.pinyin); wordScore.set(w, sc); }
  };
  for (const e of dictEntries) { consider(e.simp, e); consider(e.trad, e); }

  // Tatoeba's cmn export mixes traditional and simplified; normalise every
  // sentence to simplified so a regeneration matches the committed shards.
  const tradSimp = buildTradSimpMap(dictEntries);

  const picks = [];
  for (const [cmn, text] of cmnText) {
    const engs = engIdsByCmn.get(cmn);
    if (!engs) continue;
    const en = engs.map((id) => engText.get(id)).find(Boolean);
    if (!en) continue;
    picks.push({ id: Number(cmn), zh: text, en, len: [...text].length });
  }
  picks.sort((a, b) => (a.len - b.len) || (a.id - b.id));

  const selected = picks.slice(0, SENTENCE_LIMIT).sort((a, b) => a.id - b.id);
  const entries = selected.map((p) => {
    const zh = toSimplified(p.zh, tradSimp);
    return {
      id: p.id,
      zh,
      pinyin: makeSentencePinyin(zh, wordPinyin, maxWordLen),
      en: p.en,
    };
  });

  const shards = packSequential(entries, 150 * 1024);
  const dir = path.join(OUT, 'sentences', 'shards');
  let total = 0;
  const shardFiles = [];
  shards.forEach((sh, i) => {
    total += writeJson(path.join(dir, `${pad3(i)}.json`), sh);
    shardFiles.push({ file: `shards/${pad3(i)}.json`, count: sh.length, firstId: sh[0]?.id ?? null, lastId: sh[sh.length - 1]?.id ?? null });
  });
  const index = {
    source: SOURCES.tatoebaCmn,
    license: 'CC BY 2.0 FR',
    note: 'Short Mandarin sentences (<= ' + MAX_CN_CHARS + ' chars) with an English translation from Tatoeba; pinyin generated from CC-CEDICT (greedy longest-match, may be imperfect for rare words).',
    count: entries.length,
    shards: shardFiles,
  };
  writeJson(path.join(OUT, 'sentences', 'index.json'), index);
  log(`sentences: ${entries.length} pairs, ${shards.length} shards, ${kb(total)} total`);
  return { entries, total, index };
}

// ---------------------------------------------------------------------------
// 4. HSK word lists -> hsk/1..6.json
// ---------------------------------------------------------------------------
async function buildHsk() {
  const levels = {};
  const indexLevels = [];
  const seen = new Set(); // hanzi already introduced at a lower level (no cross-level dupes)
  let total = 0;
  for (let level = 1; level <= 6; level++) {
    const url = SOURCES.hsk.url.replace('{level}', String(level));
    const file = await cached(url, `hsk${level}.txt`);
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const items = [];
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line) continue;
      const p = line.split('\t');
      if (p.length < 5) continue;
      const [hanzi, trad, num, marks, english] = p;
      // Each level carries only NEW words: skip anything already seen at a
      // lower level (the official list repeats a few, e.g. 过/还/长 in L3).
      if (seen.has(hanzi)) continue;
      seen.add(hanzi);
      items.push({ level, hanzi, trad, pinyin: marks, pinyinNumeric: num, english });
    }
    const obj = { level, source: SOURCES.hsk, license: SOURCES.hsk.license, count: items.length, items };
    total += writeJson(path.join(OUT, 'hsk', `${level}.json`), obj);
    levels[level] = items.length;
    indexLevels.push({ level, count: items.length, file: `${level}.json` });
  }
  writeJson(path.join(OUT, 'hsk', 'index.json'), {
    source: SOURCES.hsk,
    note: 'Official HSK 2.0 (2012) vocabulary by level. Structure is ready for the newer HSK 3.0 lists too.',
    levels: indexLevels,
  });
  log(`hsk: levels ${JSON.stringify(levels)}, ${kb(total)} total`);
  return { total, levels };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  log('building data ->', path.relative(ROOT, OUT));
  // Only our own outputs: public/data also holds hand-made and translated
  // content (es/dict, lessons, readings, themes…) this script cannot regenerate.
  cleanGenerated(OUT);
  ensureDir(OUT);

  const cedictGz = await cached(SOURCES.cedict.url, 'cedict.txt.gz');
  const cedictText = zlib.gunzipSync(fs.readFileSync(cedictGz)).toString('utf8');
  const entries = parseCedict(cedictText);

  const dict = await buildDict(entries);
  const strokes = await buildStrokes();
  const sentences = await buildSentences(entries);
  const hsk = await buildHsk();

  // walk output for the global manifest
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else files.push({ file: path.relative(OUT, p), bytes: st.size });
    }
  })(OUT);
  files.sort((a, b) => (a.file < b.file ? -1 : 1));
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-data.mjs',
    note: 'Free/open datasets, pre-processed into lazy JSON shards so the app runs offline. Committed on purpose.',
    sources: Object.values(SOURCES),
    sections: {
      dict: { entries: dict.entries.length, shards: dict.shards.length, bytes: dict.total },
      strokes: { characters: strokes.chars.length, shards: strokes.shards.length, bytes: strokes.total },
      sentences: { count: sentences.entries.length, bytes: sentences.total },
      hsk: { levels: hsk.levels, bytes: hsk.total },
    },
    totalBytes,
    fileCount: files.length,
  };
  writeJson(path.join(OUT, 'manifest.json'), manifest);
  // keep a plain file list for the service worker / humans
  writeJson(path.join(OUT, 'files.json'), files);

  log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${files.length} files, ${(totalBytes / 1048576).toFixed(1)}MB`);
}

main().catch((err) => { console.error('build-data failed:', err); process.exit(1); });
