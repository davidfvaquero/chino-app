# Data pipeline (`scripts/build-data.mjs`)

Reproducible, dependency-free pipeline that turns free/open datasets into the
small JSON shards the PWA loads at runtime. Output lives in **`public/data/`**
and is **committed on purpose** so the app works with no network.

```bash
npm run data        # download (cached in .cache/) + rebuild public/data/
FORCE=1 npm run data              # ignore the cache and re-download
SENTENCE_LIMIT=5000 npm run data  # keep more Tatoeba sentences (default 3000)
npm run data:examples             # Tatoeba example sentences per dictionary word
npm run test:data                 # sanity checks on the generated JSON
```

> **Nota:** tras tocar `scripts/build-data.mjs`, corre `npm run data` y commitea el diff.
> El paso de CI (`pages.yml`) usa `git status --porcelain public/data` y falla si hay
> archivos nuevos o modificados sin commitear. Lo mismo aplica a `npm run data:examples`.

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
  examples/
    index.json                  word count + shard list + hash scheme
    shards/NNN.json             {word: [{id, zh, pinyin, en, es?}]} per word, < 150KB
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

### Dictionary examples (`npm run data:examples`)

`scripts/build-examples.mjs` downloads the Tatoeba `cmn`/`eng`/`spa` sentence
exports plus the `cmn-eng`/`cmn-spa`/`eng-spa` link tables (cached in
`data-work/examples/`, git-ignored) and writes `public/data/examples/`: for each
simplified dictionary word it keeps up to **4** sentences of **5-25** characters
that contain the word as a *word* (greedy longest-match segmentation against the
dictionary, so a word inside a longer word does not count), preferring those with
both an English and a Spanish translation and common characters, with no
duplicates and a short reject list for offensive content. Pinyin uses the same
routine as `build-data.mjs`. Words are sharded by hash (64 shards,
`{word: [...]}`), HSK 1-6 first then the most frequent corpus words, under a
total size cap (~8 MB). Each entry keeps the Tatoeba `id`.

```bash
npm run data:examples                    # download (cached) + rebuild public/data/examples/
node scripts/build-examples.mjs --dry-run  # offline, cache only, no write
```

The examples are **not** precached by the service worker: like `dict/`, they load
on demand into the runtime data cache (`tests/examples-data.test.mjs` pins this).

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
