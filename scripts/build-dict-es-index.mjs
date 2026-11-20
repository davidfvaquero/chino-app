#!/usr/bin/env node
/**
 * build-dict-es-index.mjs — Spanish word -> shards index for the dictionary.
 *
 * Builds `public/data/es/dict/index-spanish/<a-z>.json` from the Spanish shards
 * (`public/data/es/dict/shards/NNN.json`, [{id, defs}]). Each key is a Spanish
 * definition word, lowercased and **without accents** (ñ -> n), with Spanish
 * stop-words dropped; the value is the list of shard numbers whose translated
 * entries use it. The app searches this index first for a Spanish query, then
 * falls back to English (see src/dictionary.js).
 *
 * Usage:
 *   node scripts/build-dict-es-index.mjs [es-dict-dir]   # default public/data/es/dict
 *   import { buildIndex } from './build-dict-es-index.mjs'; buildIndex(dir)
 *
 * The build (scripts/build.mjs) runs it only when es shards exist; with none it
 * is a no-op and the Spanish search is simply off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** How many entries a word keeps in the search postings (priority-ordered). */
export const MAX_POSTINGS = 30;

/** simp -> HSK level (1..6), used to rank search results. Missing -> 99. */
export function hskRanks(hskDir) {
  const ranks = new Map();
  if (!hskDir || !fs.existsSync(hskDir)) return ranks;
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const file = path.join(hskDir, `${level}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const item of data?.items ?? []) {
        const hanzi = item?.hanzi;
        if (hanzi && !ranks.has(hanzi)) ranks.set(hanzi, level);
      }
    } catch {
      // a broken list only costs ranking, never correctness
    }
  }
  return ranks;
}

/**
 * Compact search postings: `<data>/search-es/<letter>.json` maps a Spanish word
 * to `[[entryId, shard], …]` (at most MAX_POSTINGS, best first). One request per
 * letter plus the few shards it points at, instead of every shard a word
 * appears in (REVIEW-2 C3).
 */
export function buildSearchIndex(esDir, { hskDir } = {}) {
  const shardsDir = path.join(esDir, 'shards');
  if (!fs.existsSync(shardsDir)) return { shards: 0, words: 0, letters: 0 };
  const ranks = hskRanks(hskDir);

  // id -> hanzi, from the English dict next to the Spanish one.
  const dictShards = path.join(path.dirname(esDir), '..', 'dict', 'shards');
  const hanziById = new Map();
  if (fs.existsSync(dictShards)) {
    for (const f of fs.readdirSync(dictShards)) {
      if (!/^\d+\.json$/.test(f)) continue;
      try {
        for (const e of JSON.parse(fs.readFileSync(path.join(dictShards, f), 'utf8'))) {
          if (e?.id != null) hanziById.set(e.id, e.simp);
        }
      } catch {
        // ignore an unreadable English shard
      }
    }
  }

  const byLetter = new Map(); // letter -> Map(word -> [{id, shard, rank}])
  let shards = 0;
  const files = fs.readdirSync(shardsDir).filter((f) => /^\d+\.json$/.test(f));
  for (const f of files) {
    const shard = Number.parseInt(f, 10);
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(shardsDir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    shards += 1;
    for (const entry of list) {
      const defs = Array.isArray(entry?.defs) ? entry.defs : [];
      const hanzi = hanziById.get(entry?.id);
      const rank = (ranks.get(hanzi) ?? 99) * 100000 + (hanzi ? [...hanzi].length * 1000 : 900) + (entry?.id ?? 0);
      for (const def of defs) {
        for (const word of new Set(esTokens(def))) {
          if (word.length < 2 || ES_STOPWORDS.has(word)) continue;
          if (!byLetter.has(word[0])) byLetter.set(word[0], new Map());
          const map = byLetter.get(word[0]);
          if (!map.has(word)) map.set(word, []);
          map.get(word).push({ id: entry.id, shard, rank });
        }
      }
    }
  }

  // Kept outside public/data/es (which holds the translated data, checked by
  // check-es-data) so a rebuild of the search index never touches it.
  const outDir = path.join(path.dirname(esDir), '..', 'search-es');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let words = 0;
  for (const [letter, map] of byLetter) {
    const obj = {};
    for (const word of [...map.keys()].sort()) {
      const seen = new Set();
      obj[word] = map
        .get(word)
        .sort((a, b) => a.rank - b.rank)
        .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
        .slice(0, MAX_POSTINGS)
        .map((p) => [p.id, p.shard]);
    }
    fs.writeFileSync(path.join(outDir, `${letter}.json`), `${JSON.stringify(obj)}\n`);
    words += map.size;
  }
  return { shards, words, letters: byLetter.size };
}

/** High-frequency words that carry no meaning on their own. */
export const ES_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a',
  'y', 'e', 'o', 'u', 'ni', 'que', 'se', 'su', 'sus', 'le', 'les', 'lo', 'es',
  'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'como', 'mas', 'más',
  'muy', 'no', 'si', 'sí', 'ya', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
  'esos', 'esas', 'aquel', 'aquella', 'uno', 'dos', 'tres', 'usar', 'hacer',
  'ser', 'estar', 'tener', 'algo', 'alguien', 'otro', 'otra', 'mismo', 'misma',
  'tal', 'cual', 'donde', 'cuando', 'porque', 'hacia', 'hasta', 'desde', 'según',
  'segun', 'también', 'tambien', 'solo', 'sólo', 'poco', 'muy', 'tan', 'tanto',
]);

/** Lowercase, accent-stripped tokens of a text (ñ -> n, ü -> u). */
export function esTokens(text) {
  const s = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return s.match(/[a-z]+/g) || [];
}

/**
 * Read every Spanish shard in `esDir/shards` and write the word -> shards index
 * to `esDir/index-spanish`. Returns { shards, words, letters }. A missing
 * `shards/` dir is a no-op (no Spanish translations yet).
 */
export function buildIndex(esDir) {
  const shardsDir = path.join(esDir, 'shards');
  if (!fs.existsSync(shardsDir)) return { shards: 0, words: 0, letters: 0 };

  const files = fs.readdirSync(shardsDir).filter((f) => /^\d+\.json$/.test(f));
  const byLetter = new Map(); // letter -> Map(word -> Set(shard))
  let shards = 0;

  for (const f of files) {
    const shard = Number.parseInt(f, 10);
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(shardsDir, f), 'utf8'));
    } catch {
      continue; // skip a half-written shard
    }
    if (!Array.isArray(list)) continue;
    shards += 1;
    for (const entry of list) {
      const defs = Array.isArray(entry?.defs) ? entry.defs : [];
      for (const def of defs) {
        for (const word of new Set(esTokens(def))) {
          if (word.length < 2 || ES_STOPWORDS.has(word)) continue;
          const letter = word[0];
          if (!byLetter.has(letter)) byLetter.set(letter, new Map());
          const map = byLetter.get(letter);
          if (!map.has(word)) map.set(word, new Set());
          map.get(word).add(shard);
        }
      }
    }
  }

  const outDir = path.join(esDir, 'index-spanish');
  // Fresh dir: drop letters that no longer have words.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let words = 0;
  for (const [letter, map] of byLetter) {
    const obj = {};
    for (const word of [...map.keys()].sort()) obj[word] = [...map.get(word)].sort((a, b) => a - b);
    fs.writeFileSync(path.join(outDir, `${letter}.json`), `${JSON.stringify(obj)}\n`);
    words += map.size;
  }
  return { shards, words, letters: byLetter.size };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : fileURLToPath(new URL('../public/data/es/dict/', import.meta.url));
  const { shards, words, letters } = buildIndex(dir);
  if (!shards) console.log('build-dict-es-index: no Spanish shards, nothing to do');
  else console.log(`build-dict-es-index: ${shards} shards -> ${words} words in ${letters} letters (${dir})`);
}
