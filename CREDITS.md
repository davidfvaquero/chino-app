# Credits & Licences

This app is **free and has no paywall, ads or paid services**. Every dataset and
library it uses is open / free, and each is attributed below with the licence it
requires. The datasets were downloaded once and re-processed into small JSON
shards under `public/data/` (see `scripts/build-data.mjs` and `scripts/README.md`).
Re-processing means the files here are **modified versions** of the originals
(format conversion, filtering, pinyin generation, sharding) — that is noted where
the licence asks for it.

---

## 1. CC-CEDICT — dictionary (`public/data/dict/`)

- **Source:** CC-CEDICT, as published at <https://www.mdbg.net/chinese/dictionary?page=cc-cedict>
  (`cedict_1_0_ts_utf-8_mdbg.txt.gz`).
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International
  (**CC BY-SA 4.0**) — <https://creativecommons.org/licenses/by-sa/4.0/>
- **Copyright:** © MDBG and the CC-CEDICT contributors.
- **Changes made:** converted the plain-text entries to JSON, converted tone
  numbers to tone marks, split into shards, and built simplified/traditional,
  pinyin and English lookup indices. The dictionary content is **share-alike**:
  any redistributed/derived versions of the CC-CEDICT *data* must keep this
  licence and attribution.

## 2. Make Me a Hanzi — stroke data (`public/data/strokes/`)

- **Source:** Make Me a Hanzi, <https://github.com/skishore/makemeahanzi>
  (`graphics.txt`, generated from the Arphic fonts).
- **Licences:** the stroke/character graphics derive from the **Arphic Public
  License** (Arphic PL) — <https://www.arphic.com.tw/> ; the Make Me a Hanzi
  *code* is **LGPL**. Combined, this repository lists the project as
  *Arphic Public License / LGPL*.
- **Copyright:** © Arphic Technology Co., Ltd. (fonts) and the Make Me a Hanzi
  authors.
- **Changes made:** kept `character`, `strokes` (SVG paths) and `medians`
  (polyline points for drawing recognition) per character and re-packed them into
  shards, in a format compatible with [hanzi-writer](https://github.com/chanind/hanzi-writer).

## 3. Tatoeba — example sentences (`public/data/sentences/`)

- **Source:** Tatoeba, <https://tatoeba.org> — Mandarin (`cmn`) sentences with
  English (`eng`) translations, from the public exports
  (<https://downloads.tatoeba.org/exports/>).
- **Licence:** Creative Commons Attribution 2.0 France (**CC BY 2.0 FR**) —
  <https://creativecommons.org/licenses/by/2.0/fr/>
- **Copyright:** © Tatoeba and the individual sentence authors. Attribution to
  the Tatoeba project and its contributors is hereby given.
- **Changes made:** kept short Mandarin sentences (≤ 12 characters) that have an
  English translation, and generated pinyin from CC-CEDICT. *Pinyin is
  auto-generated and may occasionally be wrong for rare words or polyphonic
  characters.*
- **Note:** Tatoeba sentences may be edited by their authors; the sentence IDs
  kept in `sentences/shards/*.json` (`id`) point back to the source sentence.

## 4. HSK vocabulary lists (`public/data/hsk/`)

- **Source:** the official HSK vocabulary list (2012, "HSK 2.0"), compiled with
  definitions by **hskhsk.com** — <https://github.com/glxxyz/hskhsk.com>
  (`data/lists/HSK Official With Definitions 2012 L1..L6.txt`).
- **Licence:** **MIT License** (the list compilation in that repository).
- **Underlying content:** the HSK word lists themselves are the official
  vocabulary published by **Hanban / Confucius Institute Headquarters (汉办)**;
  used here for study purposes as free reference data.
- **Changes made:** parsed to JSON with `{level, hanzi, trad, pinyin, pinyinNumeric, english}`.
- **Pinyin:** taken from the hskhsk.com list and contrasted against **CC-CEDICT**
  (the same source as the dictionary). Readings match except for tone sandhi
  (e.g. 一起 yìqǐ, 一下 yíxià), `ü` written as `v` (e.g. 女 nǚ), and the
  multi-reading 长 cháng/zhǎng — all kept as the HSK list gives them.
- **Extensibility:** the folder already contains levels 1–6; adding the newer
  HSK 3.0 lists only requires dropping another JSON in the same shape.

## 5. Make Me a Hanzi — radicals & decomposition (`public/data/radicals/`)

- **Source:** Make Me a Hanzi, <https://github.com/skishore/makemeahanzi>
  (`dictionary.txt`, generated from the same Arphic fonts as the stroke data).
- **Licences:** the stroke/character graphics derive from the **Arphic Public
  License** (Arphic PL) — <https://www.arphic.com.tw/> ; the Make Me a Hanzi
  *code* is **LGPL**. Combined, this repository lists the project as
  *Arphic Public License / LGPL*.
- **Copyright:** © Arphic Technology Co., Ltd. (fonts) and the Make Me a Hanzi
  authors.
- **Changes made:** extracted the 214 Kangxi radicals with number, symbol, pinyin,
  English meaning, and stroke count; parsed Ideographic Description Sequences
  (IDS) from the `decomposition` field for characters present in the app's
  dataset (HSK vocab + frequent characters), sharded by Unicode range; built a
  reverse index mapping each component/radical to the characters containing it.
  The 214 radical definitions (pinyin, meaning, stroke count) are compiled from
  standard Unicode Kangxi Radicals block references (public domain).

## 6. Make Me a Hanzi — etymology & mnemonics (`public/data/etymology/`)

- **Source:** Make Me a Hanzi, <https://github.com/skishore/makemeahanzi>
  (`dictionary.txt`, `etymology` field), same file as the radicals data.
- **Licences:** the data derive from the **Arphic Public License** (Arphic PL) —
  <https://www.arphic.com.tw/> ; the Make Me a Hanzi *code* is **LGPL**.
  Combined: *Arphic Public License / LGPL*.
- **Copyright:** © Arphic Technology Co., Ltd. (fonts) and the Make Me a Hanzi
  authors.
- **Changes made:** kept `type` (`pictophonetic` | `ideographic` | `pictographic`),
  `hint`, `semantic` and `phonetic` for the characters the app already ships data
  for (HSK vocab + the characters of the dictionary / strokes / sentences /
  readings / lessons), sharded by Unicode range. For pictophonetic characters the
  meaning part is glossed from the Kangxi radical table and the sound part gets
  its pinyin from the CC-CEDICT shards. **Simplified-only:** a `hint` that quotes
  a traditional-only character is omitted rather than shown.

## 7. Software libraries

- **None bundled for data processing.** `scripts/build-data.mjs` uses only the
  Node.js standard library plus the system `bunzip2` to unpack Tatoeba's `.bz2`
  exports. There is no `npm install` step and no third-party licence to track for
  the pipeline.
- **Runtime:** the app uses only built-in web platform APIs — Web Speech API
  (speech synthesis / recognition), IndexedDB/localStorage, Canvas, Service
  Worker. No paid or proprietary web service is used.
- *(If a UI library is added later, list it here with its licence.)*

---

## How to regenerate the data

```bash
npm run data        # downloads (cached in .cache/) and rebuilds public/data/
node scripts/build-etymology.mjs   # rebuilds public/data/etymology/ from .cache/dictionary.txt
npm run test:data   # sanity checks on the generated JSON
```

`public/data/` is committed on purpose so the app works fully offline. The raw
downloads live in `.cache/` and are git-ignored.
