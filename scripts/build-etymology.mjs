/**
 * build-etymology.mjs — character etymology / mnemonic data for the app.
 *
 * Source: Make Me a Hanzi `dictionary.txt` (field `etymology`, present for ~5.7k
 * characters): { type: pictophonetic|ideographic|pictographic, hint, phonetic,
 * semantic }. We keep only characters the app already ships data for (HSK vocab
 * + every character of the dictionary/strokes/sentences/readings/lessons), and
 * we drop a `hint` that quotes a traditional-only character (the app is
 * simplified-only): better no hint than a weird one.
 *
 * For pictophonetic characters the meaning part is glossed from the Kangxi
 * radical table (public/data/radicals/radicals.json) and the sound part gets its
 * pinyin from the CC-CEDICT shards — resolved here so the runtime stays trivial.
 *
 * Output (public/data/etymology/):
 *   index.json              { source, format, characters, shards, shardFiles }
 *   shards/NNN.json         { "<char>": { type, hint?, semantic?, semanticGloss?,
 *                                         phonetic?, phoneticPinyin? } }
 *   manifest.json, files.json
 *
 * Run: node scripts/build-etymology.mjs   (FORCE=1 re-downloads dictionary.txt)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('/home/homelab/chino-app');
const RAW = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data', 'etymology');
const FORCE = process.env.FORCE === '1';
const SHARD_SIZE = 500;

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  const s = JSON.stringify(obj);
  fs.writeFileSync(file, s + '\n');
  return Buffer.byteLength(s);
}

async function cached(url, name) {
  ensureDir(RAW);
  const dest = path.join(RAW, name);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  console.log('  download', name, '<-', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// ---------------------------------------------------------------------------
// Characters present in public/data (same rule as scripts/build-radicals.mjs)
// ---------------------------------------------------------------------------
function collectDataChars() {
  const chars = new Set();
  const dataDirs = [
    path.join(ROOT, 'public', 'data', 'hsk'),
    path.join(ROOT, 'public', 'data', 'dict', 'shards'),
    path.join(ROOT, 'public', 'data', 'strokes'),
    path.join(ROOT, 'public', 'data', 'sentences', 'shards'),
    path.join(ROOT, 'public', 'data', 'readings'),
    path.join(ROOT, 'public', 'data', 'lessons'),
  ];
  for (const dir of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (!f.endsWith('.json')) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (data.items) for (const item of data.items) for (const ch of item.hanzi ?? '') chars.add(ch);
      else if (Array.isArray(data)) {
        for (const item of data) {
          if (item.simp) for (const ch of item.simp) chars.add(ch);
          else if (item.character) chars.add(item.character);
          else if (item.zh) for (const ch of item.zh) chars.add(ch);
          else if (item.hanzi) for (const ch of item.hanzi) chars.add(ch);
        }
      } else if (data.dialogue) {
        for (const turn of data.dialogue) for (const ch of turn.zh ?? '') chars.add(ch);
      } else if (data.lookup) {
        for (const ch of Object.keys(data.lookup)) chars.add(ch);
      }
    }
  }
  return chars;
}

// ---------------------------------------------------------------------------
// CC-CEDICT shards: traditional-only characters + single-character pinyin
// ---------------------------------------------------------------------------
function loadDictFacts() {
  const dir = path.join(ROOT, 'public', 'data', 'dict', 'shards');
  const simp = new Set();
  const trad = new Set();
  const pinyin = new Map();
  if (!fs.existsSync(dir)) return { tradOnly: new Set(), pinyin };
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const entries = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const entry of entries) {
      if (entry.simp) for (const ch of entry.simp) simp.add(ch);
      if (entry.trad) for (const ch of entry.trad) trad.add(ch);
      if (entry.simp?.length === 1 && entry.pinyin && !pinyin.has(entry.simp)) {
        pinyin.set(entry.simp, entry.pinyin.toLowerCase());
      }
    }
  }
  const tradOnly = new Set();
  for (const ch of trad) if (!simp.has(ch)) tradOnly.add(ch);
  return { tradOnly, pinyin };
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

/** Pinyin for a few sounds the CC-CEDICT single-char lookup misses. */
function loadHskPinyin(map) {
  for (let level = 1; level <= 6; level += 1) {
    const file = path.join(ROOT, 'public', 'data', 'hsk', `${level}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of data.items ?? []) {
      if (item.hanzi?.length === 1 && item.pinyin && !map.has(item.hanzi)) map.set(item.hanzi, item.pinyin.toLowerCase());
    }
  }
}

function loadRadicalMeanings() {
  const file = path.join(ROOT, 'public', 'data', 'radicals', 'radicals.json');
  if (!fs.existsSync(file)) return new Map();
  const radicals = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(radicals.map((r) => [r.symbol, r.meaning]));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Building etymology data...');
  const t0 = Date.now();

  fs.rmSync(OUT, { recursive: true, force: true });
  ensureDir(OUT);
  ensureDir(path.join(OUT, 'shards'));

  const dictFile = await cached(
    'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
    'dictionary.txt',
  );

  const dataChars = collectDataChars();
  console.log(`Characters in public/data: ${dataChars.size}`);

  const { tradOnly, pinyin } = loadDictFacts();
  loadHskPinyin(pinyin);
  const radicalMeanings = loadRadicalMeanings();

  const entries = new Map();
  let hintsDropped = 0;
  for (const line of fs.readFileSync(dictFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const ch = o.character;
    if (!ch || !dataChars.has(ch)) continue;
    const e = o.etymology;
    if (!e || typeof e.type !== 'string') continue;

    const entry = { type: e.type };
    // A hint is only kept when it stays inside Simplified Chinese.
    if (e.hint && ![...e.hint].some((c) => CJK_RE.test(c) && tradOnly.has(c))) entry.hint = e.hint;
    else if (e.hint) hintsDropped += 1;
    if (e.semantic) {
      entry.semantic = e.semantic;
      const gloss = radicalMeanings.get(e.semantic);
      if (gloss) entry.semanticGloss = gloss;
    }
    if (e.phonetic) {
      entry.phonetic = e.phonetic;
      const py = pinyin.get(e.phonetic);
      if (py) entry.phoneticPinyin = py;
    }
    entries.set(ch, entry);
  }
  console.log(`Characters with etymology: ${entries.size} (hints dropped: ${hintsDropped})`);

  const sortedChars = [...entries.keys()].sort();
  const shards = [];
  for (let i = 0; i < sortedChars.length; i += SHARD_SIZE) {
    const chunk = sortedChars.slice(i, i + SHARD_SIZE);
    const shardData = {};
    for (const ch of chunk) shardData[ch] = entries.get(ch);
    const shardFile = `shards/${String(shards.length).padStart(3, '0')}.json`;
    writeJson(path.join(OUT, shardFile), shardData);
    shards.push({ file: shardFile, range: [chunk[0], chunk[chunk.length - 1]], count: chunk.length });
  }

  const source = {
    name: 'Make Me a Hanzi',
    url: 'https://github.com/skishore/makemeahanzi',
    license: 'Arphic Public License / LGPL',
    homepage: 'https://github.com/skishore/makemeahanzi',
    file: 'dictionary.txt',
  };

  writeJson(path.join(OUT, 'index.json'), {
    source,
    format: 'Each entry: {type: pictophonetic|ideographic|pictographic, hint?, semantic?, semanticGloss?, phonetic?, phoneticPinyin?}. Simplified only: hints quoting a traditional-only character are omitted.',
    characters: sortedChars.length,
    shards,
    shardFiles: shards.map((s) => s.file),
  });

  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push({ file: path.relative(OUT, p), bytes: fs.statSync(p).size });
    }
  })(OUT);
  files.sort((a, b) => (a.file < b.file ? -1 : 1));

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-etymology.mjs',
    sources: [source],
    sections: { etymology: { characters: sortedChars.length, shards: shards.length, hintsDropped } },
    totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    fileCount: files.length,
    files,
  };
  writeJson(path.join(OUT, 'manifest.json'), manifest);
  writeJson(path.join(OUT, 'files.json'), files);

  console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${files.length} files, ${(manifest.totalBytes / 1024).toFixed(1)}KB`);
}

main().catch((error) => { console.error(error); process.exit(1); });
