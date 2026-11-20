// scripts/build-sentences-es.mjs
//
// Spanish sentences for the app: reads the already-built English sentence
// pairs (public/data/sentences/) and writes public/data/es/sentences/ with the
// EXACT same structure (same index + shard files, same ids and order). In each
// entry the `en` field is replaced by the free Spanish (spa) Tatoeba
// translation when one is linked to the Chinese sentence:
//   1. a direct cmn-spa Tatoeba link, else
//   2. a spa sentence linked to the pair's English (eng) translation.
// When neither exists the original English is kept unchanged (schema identical:
// {id, zh, pinyin, en}). Raw Tatoeba downloads are cached in .cache/ (git-ignored).
//
// Sources (official Tatoeba exports, CC BY 2.0 FR):
//   per_language/cmn/cmn-spa_links.tsv.bz2
//   per_language/eng/eng-spa_links.tsv.bz2
//   per_language/spa/spa_sentences.tsv.bz2
//   per_language/cmn/cmn-eng_links.tsv.bz2
//
// Usage: node scripts/build-sentences-es.mjs   (npm run data:sentences-es)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildTradSimpMap, toSimplified } from './lib/trad-simp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '.cache');                        // raw downloads (git-ignored)
const ORIG = path.join(ROOT, 'public', 'data', 'sentences');  // English pairs (input)
const OUT = path.join(ROOT, 'public', 'data', 'es', 'sentences'); // committed output
const FORCE = process.env.FORCE === '1';

const SOURCES = {
  cmnSpaLinks: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-spa_links.tsv.bz2',
  engSpaLinks: 'https://downloads.tatoeba.org/exports/per_language/eng/eng-spa_links.tsv.bz2',
  spaSentences: 'https://downloads.tatoeba.org/exports/per_language/spa/spa_sentences.tsv.bz2',
  cmnEngLinks: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2',
};

const log = (...a) => console.log(...a);
const pad3 = (n) => String(n).padStart(3, '0');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj) + '\n');
}

/** Download `url` to `.cache/<name>` unless already cached (FORCE=1 re-downloads). */
async function cached(url, name) {
  ensureDir(RAW);
  const dest = path.join(RAW, name);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
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

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(ORIG, 'index.json'), 'utf8'));

  // The input shards are already simplified, but normalise `zh` again from the
  // committed CC-CEDICT shards so running this script on older data cannot
  // reintroduce traditional forms (REVIEW #16).
  const dictDir = path.join(ROOT, 'public', 'data', 'dict');
  const dictManifest = JSON.parse(fs.readFileSync(path.join(dictDir, 'manifest.json'), 'utf8'));
  const dictEntries = [];
  for (const file of dictManifest.shardFiles) {
    dictEntries.push(...JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8')));
  }
  const tradSimp = buildTradSimpMap(dictEntries);

  // 1) the app's entries, in their original shard layout (ids/order preserved)
  const shards = index.shards.map((s) => ({
    meta: s,
    entries: JSON.parse(fs.readFileSync(path.join(ORIG, s.file), 'utf8')),
  }));
  for (const sh of shards) {
    for (const e of sh.entries) e.zh = toSimplified(e.zh, tradSimp);
  }
  const ids = new Set();
  for (const sh of shards) for (const e of sh.entries) ids.add(String(e.id));
  log(`es: ${ids.size} sentences in ${shards.length} shards`);

  // 2) Tatoeba link tables
  const cmnSpaFile = await cached(SOURCES.cmnSpaLinks, 'cmn-spa_links.tsv.bz2');
  const engSpaFile = await cached(SOURCES.engSpaLinks, 'eng-spa_links.tsv.bz2');
  const cmnEngFile = await cached(SOURCES.cmnEngLinks, 'cmn-eng_links.tsv.bz2');

  const spaDirectByCmn = new Map(); // cmn -> [spa] (link order)
  await forEachBz2Line(cmnSpaFile, (line) => {
    const t = line.indexOf('\t'); if (t < 0) return;
    const cmn = line.slice(0, t), spa = line.slice(t + 1);
    if (!ids.has(cmn)) return;
    if (!spaDirectByCmn.has(cmn)) spaDirectByCmn.set(cmn, []);
    spaDirectByCmn.get(cmn).push(spa);
  });

  const engByCmn = new Map();  // cmn -> [eng] (link order)
  await forEachBz2Line(cmnEngFile, (line) => {
    const t = line.indexOf('\t'); if (t < 0) return;
    const cmn = line.slice(0, t), eng = line.slice(t + 1);
    if (!ids.has(cmn)) return;
    if (!engByCmn.has(cmn)) engByCmn.set(cmn, []);
    engByCmn.get(cmn).push(eng);
  });

  const spaByEng = new Map(); // eng -> [spa]
  const needSpa = new Set();
  for (const list of spaDirectByCmn.values()) for (const s of list) needSpa.add(s);
  await forEachBz2Line(engSpaFile, (line) => {
    const t = line.indexOf('\t'); if (t < 0) return;
    const eng = line.slice(0, t), spa = line.slice(t + 1);
    if (!spaByEng.has(eng)) spaByEng.set(eng, []);
    spaByEng.get(eng).push(spa);
    needSpa.add(spa);
  });

  // 3) the Spanish texts we need
  const spaFile = await cached(SOURCES.spaSentences, 'spa_sentences.tsv.bz2');
  const spaText = new Map();
  await forEachBz2Line(spaFile, (line) => {
    const i = line.indexOf('\t'); if (i < 0) return;
    const j = line.indexOf('\t', i + 1); if (j < 0) return;
    const id = line.slice(0, i);
    if (needSpa.has(id)) spaText.set(id, line.slice(j + 1));
  });

  const spaFor = (spaIds) => { for (const s of spaIds) { const t = spaText.get(s); if (t) return t; } return null; };
  const direct = (cmn) => spaFor(spaDirectByCmn.get(cmn) || []);
  const pivot = (cmn) => {
    for (const eng of engByCmn.get(cmn) || []) {
      const t = spaFor(spaByEng.get(eng) || []);
      if (t) return t;
    }
    return null;
  };

  // 4) rewrite each shard: replace `en` with Spanish when available
  let nDirect = 0, nPivot = 0, nEnglish = 0;
  for (const sh of shards) {
    const out = sh.entries.map((e) => {
      const d = direct(String(e.id));
      if (d) { nDirect++; return { id: e.id, zh: e.zh, pinyin: e.pinyin, en: d }; }
      const p = pivot(String(e.id));
      if (p) { nPivot++; return { id: e.id, zh: e.zh, pinyin: e.pinyin, en: p }; }
      nEnglish++;
      return e; // keep the original English (and any other fields) untouched
    });
    writeJson(path.join(OUT, sh.meta.file), out);
  }

  // 5) index: identical schema/shard layout, Spanish note
  const esIndex = {
    source: index.source,
    license: index.license,
    note: 'Short Mandarin sentences (<= 12 chars) with a Tatoeba translation: `en` holds the ' +
      'free Spanish (spa) Tatoeba translation when one is linked to the Chinese sentence ' +
      '(direct cmn-spa link, else a spa sentence linked to the pair\'s English translation); ' +
      'otherwise the original English is kept. Pinyin generated from CC-CEDICT.',
    count: index.count,
    shards: index.shards,
  };
  writeJson(path.join(OUT, 'index.json'), esIndex);

  const covered = nDirect + nPivot;
  const pct = (100 * covered / ids.size).toFixed(1);
  log(`es sentences: ${ids.size} entries, ${covered} with Spanish (${pct}%) ` +
    `[direct ${nDirect}, via-English ${nPivot}], ${nEnglish} kept English`);
  log(JSON.stringify({ count: ids.size, spanish: covered, direct: nDirect, pivot: nPivot, english: nEnglish, pct }));
}

main().catch((err) => { console.error(err); process.exit(1); });
