# Conventions — chino-app

Vanilla ES modules, **zero npm dependencies**, offline-first PWA. Read this
before touching the repo: it is the contract that lets ~20 tasks edit the tree
at the same time without stepping on each other.

Golden rules for parallel work:

1. **Edit only the files your task lists.** Need another file? Block with
   `needs_input` naming it — do not touch it.
2. **No new npm dependencies.**
3. **Never build into `dist/`** (siblings would clobber it). Use
   `OUT_DIR=/tmp/chino-<task-id> npm run build`.
4. **No literal UI text in code.** Every string comes from `t('key')` and lives
   in your own locale file (see §3).
5. **Tests live in `tests/<area>.test.mjs`** (see §4).
6. Git: `git add <only your files> && git commit -m "..."`. Never `git add -A`,
   never reset/checkout/stash/rebase.

## 1. Ownership

One file, one owner. `—` = finished and frozen.

| Task | Files |
| --- | --- |
| `t_4e91e305` — | `package.json`, `index.html`, `sw.js`, `src/main.js`, `src/router.js`, `src/storage.js`, `src/dom.js`, `src/icons.js`, `src/pwa.js`, `src/styles.css`, `src/locales/en.json`, `src/locales/index.json`, `src/screens/placeholder.js` |
| `t_cc00080e` — | `public/data/**`, `scripts/build-data.mjs`, `scripts/lib/**`, `CREDITS.md`, `tests/data-sanity.test.mjs` |
| `t_693ab749` — | `docs/CONVENTIONS.md`, `src/i18n.js`, `src/screens/learn.js`, `src/screens/extras.js`, `src/learn/*.js` (stubs), `src/extras/*.js` (stubs), `src/locales/en.d/hubs.json`, `scripts/build.mjs`, `scripts/build-locales.mjs`, `scripts/serve.mjs`, `package.json` scripts, `tests/i18n-locales.test.mjs` |
| `t_2a841cdc` | `src/srs.js`, `tests/srs.test.mjs` |
| `t_b1683504` | `src/audio.js`, `src/speech.js`, `tests/audio.test.mjs`, `tests/speech.test.mjs` |
| `t_4af6feda` | `src/gamification.js`, `public/data/achievements.json`, `tests/gamification.test.mjs` |
| `t_0cbbde9a` | `src/dictionary.js`, `src/pinyin.js`, `tests/dictionary.test.mjs` |
| `t_67316b47` | `src/screens/dictionary.js`, `src/locales/en.d/dict.json` |
| `t_7657e051` | `src/screens/review.js`, `src/locales/en.d/review.json`, `tests/review-screen.test.mjs` |
| `t_5493fb46` | `src/learn/lessons.js`, `src/learn/exercises.js`, `src/locales/en.d/learn.json`, `docs/lesson-schema.md`, `public/data/lessons/hsk1/index.json`, `public/data/lessons/hsk1/lesson-01.json`, `tests/exercises.test.mjs` |
| `t_c41816e2` | `src/learn/tones.js`, `public/data/lessons/tones.json`, `src/locales/en.d/tones.json`, `tests/tones.test.mjs` |
| `t_55647719` | `src/learn/strokes.js`, `src/locales/en.d/strokes.json`, `tests/strokes.test.mjs` |
| `t_6399bd4d` | `src/learn/sentences.js`, `src/locales/en.d/sentences.json`, `tests/sentences.test.mjs` |
| `t_717f4f03` | `src/screens/read.js`, `src/reading/*.js`, `src/locales/en.d/read.json`, `docs/reading-schema.md`, `public/data/readings/hsk1/index.json`, `public/data/readings/hsk1/reading-01.json`, `tests/reading.test.mjs` |
| `t_61321803` | `src/extras/profile.js`, `src/locales/en.d/profile.json` |
| `t_d909160e` | `src/extras/draw.js`, `src/locales/en.d/draw.json`, `tests/draw-ui.test.mjs` |
| `t_d9f37576` | `src/extras/pronounce.js`, `src/locales/en.d/pronounce.json`, `tests/pronounce.test.mjs` |
| `t_7caa44a4` | `src/extras/strokematch.js`, `docs/strokematch.md`, `tests/strokematch.test.mjs` |

Shared directories, one file per task inside them: `src/locales/en.d/`,
`public/data/**`, `docs/`, `tests/`. Never edit another task's file there.

## 2. Screens and hubs

A screen is any module exporting:

```js
export const titleKey = 'screens.<name>.title';   // i18n key, used as the header
export function render(container, ctx) {}          // may return a cleanup function
```

`ctx = { route: { name, segments, params, path }, navigate }`. `route.segments`
holds everything after the first path segment, so `#/learn/strokes/你` gives
`name: 'learn'`, `segments: ['strokes', '你']`. Register the screen in `SCREENS`
(and `NAV` for a tab) in `src/main.js`.

Hubs dispatch on `route.segments[0]` with a dynamic `import()`, so each area is
its own file:

- `src/screens/learn.js` → `src/learn/{lessons,tones,strokes,sentences}.js`
  (no segment = menu with 4 cards)
- `src/screens/extras.js` → `src/extras/{profile,draw,pronounce}.js`
  (no segment = menu with 3 cards)

A hub area uses the same contract as a screen (`titleKey` + `render`); the hub
renders `t(module.titleKey)` as its menu label, so replacing a stub with a real
module automatically renames its card.

`src/screens/dictionary.js`, `review.js` and `read.js` are single files (no
sub-hub).

## 3. Texts (i18n) — one file per module

`src/locales/en.json` is the shared shell file: **do not edit it.** Every module
owns a shard with its own key prefix:

```
src/locales/en.d/<area>.json      e.g. en.d/dict.json, en.d/review.json, en.d/tones.json
```

The app's dictionary is `en.json` **plus every** `en.d/*.json`, deep-merged into
one `locales/en.json`. The merge happens in the build and in the server
(`scripts/build-locales.mjs`); a *leaf* key written by two files is a **build
error** naming both files, so two tasks can never silently overwrite each other.
Objects merge recursively, so `en.d/tones.json` can add `tones.*` next to the
shared keys. The `en.d/` shards are dropped from the build output.

Rules:

- One shard per area, keys prefixed by the area (`dict.*`, `review.*`, `tones.*`,
  `read.*`, `gamification.*`, …). Never write a bare top-level string key.
- Never a literal user-visible string in code — always `t('key')`, with
  `t('key', { name })` interpolating `{name}`.
- Missing keys fall back to the default locale, then to the key itself (so a
  typo shows up as `dict.search` on screen).

**New language:** drop `src/locales/<code>.json` (with `locale.name`) and, if the
modules need it, a matching `src/locales/<code>.d/` with the same shard names,
then list `<code>` in `src/locales/index.json`. Nothing else — the build and the
server glob whatever files exist. `es.json` + `es.d/` is exactly this.

**Keep `es` current:** when you add a key to `en.json`/`en.d/*.json`, add the
matching `es.json`/`es.d/*.json` key too; `node scripts/check-i18n.mjs` lists any
English keys still missing a Spanish translation (missing keys fall back to
English). `tests/i18n-es.test.mjs` fails if an es shard drifts from its en shard.

## 4. Tests

- One file per area: `tests/<area>.test.mjs`, `node:test` + `node:assert/strict`.
- Run everything: `npm test` (`node --test tests/`). Run just yours:
  `node --test tests/<area>.test.mjs`.
- Tests must not need a browser. Pure logic is separated from DOM for exactly
  this reason (e.g. SRS scheduling, exercise grading, stroke matching).
- Test what you own; do not add assertions about another task's file.

## 5. Build and serve (parallel-safe)

```sh
OUT_DIR=/tmp/chino-<task-id> npm run build   # writes only under OUT_DIR (default dist/)
node scripts/serve.mjs /tmp/chino-<task-id>  # static server on a FREE port, printed on start
```

`npm run build` copies the shell + `src/` + `public/` into `OUT_DIR`, merges the
locale shards, generates `manifest.webmanifest` from the merged `en` locale and
stamps a content hash into `sw.js` (each build rotates the SW caches). Two builds
with different `OUT_DIR` values never touch each other's files.

`scripts/serve.mjs [dir]` serves `dir` and, so the source tree works too,
merges `<code>.d/` shards into any `<...>/locales/<code>.json` request and
generates `/manifest.webmanifest` when it is missing. `npm run dev` is
`serve.mjs .`.

## 6. Module APIs

Each module's own header comment is authoritative; this is the planned shape.

```js
// src/i18n.js
t(key, params)                    // -> string, {placeholder} interpolation
registerLocale(code, dict)        // add/replace a locale dictionary
loadLocale(code, base?)           // fetch + register <code>.json
loadAvailableLocales(base?)       // load every code in locales/index.json
setLocale(code) / getLocale() / availableLocales() / hasLocale(code)
localeLabel(code) / has(key) / subscribe(fn)
mergeDictionaries([{name, dict}], {onDuplicate})   // shard merge + collision rule

// src/storage.js  (default export; the ONLY place that touches IndexedDB/localStorage)
storage.get(store, key) / set(store, key, value) / delete(store, key) / list(store) / name()
// stores: meta, settings, srs, progress, gamification ; onWrite(fn) = sync hook

// src/router.js
parseRoute(hash) / href(path) / navigate(path, {replace}) / createRouter({container, screens, fallback, onRoute})

// src/dom.js
h(tag, props, ...children) / reset(container)

// src/srs.js  (owner t_2a841cdc)
grade(card, rating, now) / nextDue(...)            // pure; rating: again|hard|good|easy
addToReview({id, hanzi, pinyin, english, source})  // idempotent
getDueCards(now) / answer(cardId, rating) / countDue(now)

// src/audio.js  (owner t_b1683504)
isTtsAvailable() / speak(text, {lang='zh-CN', rate})   // -> Promise, never throws

// src/speech.js  (owner t_b1683504)
isRecognitionAvailable()
listen({lang='zh-CN', timeoutMs})   // -> {ok, transcript, confidence, reason}
compare(expected, transcript)       // -> {match, score}   (hanzi only)
// reason: 'unsupported' | 'denied' | 'no-speech' | 'error' — translate it with t()

// src/gamification.js  (owner t_4af6feda)
record(event)   // review_done|lesson_done|reading_done|stroke_done|draw_used|speak_done
getStats()      // -> {streak, bestStreak, points, level, achievements[], todayDone}
evaluateAchievements(stats, defs)   // pure

// src/dictionary.js  (owner t_0cbbde9a)
search(query, {limit})   // hanzi / pinyin (tone marks, numbers, plain) / english
lookup(word) / segment(text)   // segment() = longest-match word split for the reader

// src/pinyin.js  (helper used by the dictionary)
tonelessKey(pinyin)   // 'nǐ hǎo' | 'ni3 hao3' | 'ni hao' -> 'nihao'

// src/extras/strokematch.js  (owner t_7caa44a4)
loadIndex() / match(strokes, {max})   // -> [{char, score}]
```

Cross-module events are dispatched on `window` (a screen fires, another listens;
do not import the other module): `chino:lesson_done`, `chino:review_done`,
`chino:reading_done`, `chino:stroke_done`, `chino:draw_used`,
`chino:speak_done`.

## 7. Data

Generated JSON lives under `public/data/` (`dict/`, `strokes/`, `sentences/`,
`hsk/`, `lessons/`, `readings/`), rebuilt with `npm run data`. It is copied to
the site root by the build, so runtime URLs are `/data/...`. See `CREDITS.md`
and `scripts/README.md`; never hand-edit generated shards.

Out of scope for this project: camera/OCR capture and subtitled video.

## 8. Look and feel

`src/styles.css` is the design system (tokens, shared classes, light/dark/auto,
font scale). Before writing any CSS for a screen read `docs/DESIGN.md`: use
`.btn`, `.card`, `.field`, `.chip`, `.pill`, `.progress`, `.menu`, `hanziCell()`
and the `--ink`/`--surface`/`--accent`/`--tone1…5` tokens; no hard-coded colours,
no `@media (prefers-color-scheme)`, no uppercase eyebrow labels, targets >= 44 px.
Verify with `node scripts/check-contrast.mjs <build dir>`.
