#!/usr/bin/env node
/**
 * build-dict-es-index.mjs — Spanish word -> shards search index.
 *
 * Builds `public/data/search-es/<a-z>.json` from the Spanish shards
 * (`public/data/es/dict/shards/NNN.json`, [{id, defs}]). Each key is a Spanish
 * definition word, lowercased and **without accents** (ñ -> n), with Spanish
 * stop-words dropped and CC-CEDICT reference markup removed (see src/es-tokens.js);
 * the value is `[[entryId, shard], …]`, best first, at most MAX_POSTINGS. The app
 * searches this index for a Spanish query and only asks for the few shards it
 * points at (src/dictionary.js).
 *
 * Usage:
 *   node scripts/build-dict-es-index.mjs [es-dict-dir]   # default public/data/es/dict
 *   import { buildSearchIndex } from './build-dict-es-index.mjs'; buildSearchIndex(dir)
 *
 * The build (scripts/build.mjs) runs it only when es shards exist; with none it
 * is a no-op and the Spanish search is simply off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esTokens, ES_STOPWORDS } from '../src/es-tokens.js';

export { esTokens, ES_STOPWORDS };

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
 * Rank of one (word, entry) posting. Lower is better. HSK words come first (a
 * student typing "cafe" wants 咖啡, not the rare 噶霏), then the strongest
 * definition hit: a definition whose first word is the query, then the token's
 * position, the word length and the id. One wide integer keeps the whole order
 * in the postings, so the client only has to trust the list order (REVIEW-3 I6).
 */
function postingRank({ level, exact, position, length, id }) {
  return level * 1e13 + exact * 1e12 + position * 1e9 + length * 1e6 + id;
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
      const level = ranks.get(hanzi) ?? 99;
      const length = hanzi ? [...hanzi].length : 99;
      for (const def of defs) {
        const tokens = esTokens(def);
        const normDef = tokens.join(' ');
        for (const word of new Set(tokens)) {
          if (word.length < 2 || ES_STOPWORDS.has(word)) continue;
          // A definition whose first word is the query is the strongest hit
          // ("comer" for 吃); a query that is only a prefix of the first word
          // ("casa" inside "casado") is not. Position, HSK level, length and id
          // then break the ties.
          const exact = normDef === word || normDef.startsWith(`${word} `) ? 0 : 1;
          const rank = postingRank({
            level,
            exact,
            position: tokens.indexOf(word),
            length,
            id: entry.id ?? 0,
          });
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : fileURLToPath(new URL('../public/data/es/dict/', import.meta.url));
  const hskDir = fileURLToPath(new URL('../public/data/hsk/', import.meta.url));
  const { shards, words, letters } = buildSearchIndex(dir, { hskDir });
  if (!shards) console.log('build-dict-es-index: no Spanish shards, nothing to do');
  else console.log(`build-dict-es-index: ${shards} shards -> ${words} words in ${letters} letters (search-es)`);
}
