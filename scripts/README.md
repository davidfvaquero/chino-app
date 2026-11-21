# Data pipeline (`scripts/build-data.mjs`)

Reproducible, dependency-free pipeline that turns free/open datasets into the
small JSON shards the PWA loads at runtime. Output lives in **`public/data/`**
and is **committed on purpose** so the app works with no network.

```bash
npm run data        # download (cached in .cache/) + rebuild public/data/
FORCE=1 npm run data              # ignore the cache and re-download
SENTENCE_LIMIT=5000 npm run data  # keep more Tatoeba sentences (default 3000)
npm run test:data                 # sanity checks on the generated JSON
```

> **Nota:** tras tocar `scripts/build-data.mjs`, corre `npm run data` y commitea el diff.
> El paso de CI (`pages.yml`) usa `git status --porcelain public/data` y falla si hay
> archivos nuevos o modificados sin commitear.

Raw downloads are cached in `.cache/` (git-ignored) so repeat runs are fast and
offline. The build only needs Node.js and the system `bunzip2` — no `npm install`.

## Sources (all free / open — see `/CREDITS.md` for full attribution)

| Source | Licence | Used for |
| --- | --- | --- |
| CC-CEDICT | CC BY-SA 4.0 | dictionary entries |
| Make Me a Hanzi `graphics.txt` | Arphic PL / LGPL | stroke order + drawing data |
| Tatoeba `cmn`/`eng` exports | CC BY 2.0 FR | short example sentences |
| hskhsk.com HSK lists | MIT | HSK 1–6 vocabulary |

## Output layout

```
public/data/
  manifest.json                 global manifest (sources, counts, total size)
  files.json                    flat file list (size of every generated file)
  dict/
    manifest.json               shard scheme + index map
    shards/NNN.json             CC-CEDICT entries, each < 200KB
    index-hanzi.json            simplified first char -> shard(s)   (~116KB)
    index-hanzi-trad.json       traditional first char -> shard(s)  (~128KB)
    index-pinyin/<a-z>.json     toneless pinyin key -> shard(s)     (per letter)
    index-english/<a-z>.json    english word -> shard(s)            (per letter)
  strokes/
    index.json                  char -> shard + shard ranges
    shards/NNN.json             {character, strokes, medians} per char, < 200KB
  sentences/
    index.json                  shard list + sentence count
    shards/NNN.json             {id, zh, pinyin, en} pairs
  hsk/
    index.json                   levels + counts
    1.json … 6.json               {level, hanzi, trad, pinyin, pinyinNumeric, english}
```

### How lazy loading works

- **By hanzi:** look up the first character in `index-hanzi.json`
  (or `index-hanzi-trad.json` for a traditional query) to get the shard id(s),
  download just those, and keep entries whose `simp`/`trad` starts with the query.
  Entries are grouped by first character, so a word never spans more than a
  couple of shards.
- **By pinyin:** normalise the query to a toneless key (`nǐ hǎo` / `ni3 hao3` /
  `ni hao` / `nihao` all → `nihao`) and look it up in `index-pinyin/<letter>.json`.
- **By English:** look the word up in `index-english/<letter>.json`. Very common
  function words are not indexed (they carry no lookup value and would explode
  the index); the list is in the dictionary manifest.
- **Strokes:** `strokes/index.json` maps each character to its shard, so a single
  small shard is enough to draw/animate one character.

Every shard is JSON **and** small (< 200KB) so it is cheap to fetch and parse on
a phone. The service worker can cache shards on first use for offline access.

## Notes / limitations

- **Pinyin generation for sentences** uses a greedy longest-match over CC-CEDICT
  with a deterministic "primary reading" heuristic (demote *variant of*/*surname*
  glosses, promote neutral-tone readings of common particles). It is good but not
  perfect for polyphonic characters/rare words — see `makeSentencePinyin` and
  `scoreOf` in `scripts/build-data.mjs`.
- **`hsk/6.json`** is ~300KB (2500 words with long English glosses); it is a
  single per-level file by design and is loaded only when that level is opened.
- The **strokes** data (Make Me a Hanzi) is the largest part (~30MB) because it
  contains the full SVG stroke outlines for 9,574 characters.
