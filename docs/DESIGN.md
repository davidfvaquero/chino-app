# Design system — "papel y tinta"

Chino is a free PWA to learn Mandarin from zero, for Spanish and English
speakers, in short daily sessions on a phone (Android Chrome, 390 px). The
look comes from the subject: a **calligraphy practice notebook** — rice paper,
ink, and the 田字格 practice grid. Everything is calm and quiet around **one**
memorable element: hanzi sitting on that grid.

Source of truth: `src/styles.css` (tokens + shared classes), `src/hanzi.js`
(the grid-cell helper), `src/learn/exercise-ui.css.js` (exercise kit).
Guard: `node scripts/check-contrast.mjs <build dir>` (see §8 of that file).

## 1. The plan (two passes)

### Pass 1 — first plan

| Axis | Choice |
| --- | --- |
| Palette (light) | Papel `#EEF1EC` (desk) · Hoja `#FAFBF8` (sheet) · Tinta `#162326` (text) · Jade 青 `#17645F` (accent) · Trazo `#D2D9D2` (hairline) |
| Palette (dark) | Piedra `#0F1518` · Hoja `#172024` · Tinta `#E8EFEB` · Jade `#6CC6BB` · Trazo `#2A363A` |
| Type | One family, **Onest** (self-hosted, 37 KB) for the UI; system Chinese fonts for hanzi |
| Layout | One column, 16 px gutter, left-aligned text, hanzi centred inside its cell |
| Memorable element | Hanzi on a dotted practice grid (`.hz-cell`), one grid tile per character |
| Motion | The page settles in (opacity) and big hanzi "ink in" (blur → sharp); everything else answers a touch |

Wireframes (390 px):

```
Home                          Review (back)                  Lesson · match
┌────────────────────┐        ┌────────────────────┐         ┌────────────────────┐
│ Inicio             │        │ Repaso             │         │ Aprender           │
│ Siguiente paso     │        │ (Clásico)(Inversa) │         │ ┌────────────────┐ │
│ [ Repasar (3)     ] │        │ 3 pend.   [Audio]  │         │ │ Ejercicio 4/8  │ │
│ Meta diaria        │        │ ┌────────────────┐ │         │ │ ▓▓▓▓░░░░░░░░   │ │
│ 0/20 ░░░░░░░░░░    │        │ │ ┌┄┄┬┄┄┐        │ │         │ │ Une cada…      │ │
│ ┌────────────────┐ │        │ │ │你┆好┆        │ │         │ │ [你 ①] [gracias①]│ │
│ │ Palabra del día│ │        │ │ └┄┄┴┄┄┘        │ │         │ │ [谢谢②] [adiós ②]│ │
│ │ ┌┄┄┬┄┄┐        │ │        │ └────────────────┘ │         │ │ [   Comprobar  ]│ │
│ │ │五┆ │ wǔ      │ │        │ ┌────────────────┐ │         │ └────────────────┘ │
│ │ └┄┄┴┄┄┘ cinco  │ │        │ │ nǐ hǎo · hello │ │         │ tab bar (6 tabs)   │
│ └────────────────┘ │        │ └────────────────┘ │         └────────────────────┘
│ tab bar (6 tabs)   │        │ [Otra vez][Difícil] │
└────────────────────┘        │ [Bien]   [Fácil]    │
                              └────────────────────┘
```

### Review against the brief — what was dropped as "default"

- **Terracotta/red/gold** (postcard China) and a **cream + high-contrast serif**
  → replaced by cool rice-paper grey-green, jade 青 and a plain geometric sans.
- **One identical rounded card with grey shadow everywhere** → sheets are
  reserved for the one task in progress (exercise, review card, word of the
  day). Lists are hairline rows without boxes (dictionary, vocabulary, reading);
  hubs are tiles with a hanzi emblem; no shadows, no gradients.
- **Uppercase tracked eyebrow labels** (the old `.home h2`, `.pill`, `.group-title`) → sentence case, bold.
- **`→` on buttons**, mono "data" labels, middle-dot meta strings → none. The
  hub chevron is a drawn CSS corner, not a glyph.
- **Dark = near-black + neon accent** → dark is the same ink-and-jade palette
  (soft jade, blue-green ink), not a second brand.
- **A numbered 01/02/03 scheme** → numbers appear only where they are real
  (exercise 4 of 8, match pairs 1–6).
- **A first font (Atkinson Hyperlegible Next)** was built and then dropped: it
  lacks ǎ ǐ ǒ ǔ ǖ ǘ ǚ ǜ ō, so pinyin would have been a patchwork of fallback
  glyphs. Onest has every pinyin vowel.

### Self-critique after building

Checked against the five clusters of generic AI design: (1) cream/serif/clay —
no; (2) near-black + acid accent — dark theme is soft jade on blue-green ink,
the weakest spot, revisit if it ever reads as "dev tool"; (3) broadsheet — no;
(4) SaaS card kit — hubs/lists/sheets have different shapes and the radii step
(8/12/18 px); (5) template chrome — no eyebrows, mono, arrows, spaced em dashes.
One accessory removed before building: a brush-stroke mark next to the page title.

## 2. Tokens

All colours are **one** `light-dark()` declaration on `:root`; `color-scheme`
decides the side. `src/settings.js` owns no colours: it sets
`<html data-theme="light|dark">` (auto resolves to one of the two) and
`--font-scale` (root `font-size: calc(16px * var(--font-scale, 1))`, so every
`rem` scales). Without the attribute the OS preference wins. Needs
`light-dark()` (Chrome 123+, Safari 17.5+, Firefox 120+).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#eef1ec` | `#0f1518` | page (desk) |
| `--surface` | `#fafbf8` | `#172024` | sheets, buttons, fields |
| `--inset` | `#e3e8e2` | `#202b30` | wells, pressed, pills, tracks |
| `--ink` / `--ink-soft` | `#162326` / `#4a5a5c` | `#e8efeb` / `#a9b8b6` | text / secondary text (≥ 4.5:1 on all three surfaces) |
| `--line` | `#d2d9d2` | `#2a363a` | hairlines and dividers (decoration, **not** a control boundary) |
| `--edge` | `#72807d` | `#6a7b7b` | boundary of buttons, fields, chips (≥ 3:1) |
| `--accent` / `--accent-fg` | `#17645f` / `#f4faf8` | `#6cc6bb` / `#0b1f1d` | primary action, progress, selection, links |
| `--focus` | = `--accent` | = `--accent` | focus ring (`:focus-visible`, 3 px) |
| `--danger` | `#a22c27` | `#f28b80` | wrong, destructive |
| `--ok` | = `--accent` | = `--accent` | right |
| `--accent-wash`, `--ok-wash`, `--danger-wash` | 12–13 % mixes over `--surface` | | selected / right / wrong fills |
| `--tone1…5` | `#b3271f #2a7436 #1f58b8 #8a3aa8 #5e6a6b` | `#ff8a80 #7bd38a #7fb2ff #d29cf0 #a9b4b5` | pinyin tones 1–4 + neutral, ≥ 4.5:1 on bg/surface/inset |
| `--pair-1…6` | six hues | lighter | match-exercise pairs |
| `--grid` | accent at 40 % | | the practice grid |

Legacy aliases (kept so module CSS written before this system still works):
`--bg-soft`, `--bg-elevated` = surface; `--fg` = ink; `--fg-soft`, `--muted` =
ink-soft; `--radius` = 12 px; `--pad`, `--tabbar-h`. Do not use them in new code.

Never hard-code a colour in a module: use a token. Never write `@media
(prefers-color-scheme)` in a module: tokens already switch.

### Type

- UI: **Onest** (variable 100–900, OFL, `public/fonts/onest-latin.woff2`,
  declared in `CREDITS.md`).
- Hanzi: `var(--font-hanzi)` = PingFang SC, Noto Sans SC/CJK SC, Source Han
  Sans SC, Microsoft YaHei, WenQuanYi Zen Hei. No Chinese web font (size, offline).
- No request to a CDN or Google Fonts, ever.

| Step | Size | Use |
| --- | --- | --- |
| `--fs-sm` | 0.875 rem | hints, buttons `.sm`, secondary |
| `--fs-base` | 1 rem | body (line-height 1.5) |
| `--fs-md` | 1.125 rem | prompts, pinyin, `h2` |
| `--fs-lg` | 1.375 rem | page title, big pinyin |
| `--fs-xl` | 1.75 rem | result score, reader title, review meaning |
| hanzi cell | 3.5 / 5 / 7 rem | `.hz-cell.sm / .md / .lg` |

Headings 700 with `letter-spacing: -0.01em`; body 400; buttons 600. Line
length stays under 80 characters (the app is one 40 rem column at most).

### Shape and rhythm

`--r-sm` 8 px (grid cell) · `--r-md` 12 px (buttons, fields, chips) · `--r-lg`
18 px (sheets, hub tiles). Gutter `--pad` 16 px, block gap `--gap` 12 px,
sections on Home 24 px. No shadows; separation is hairline + surface step.

## 3. Shared classes

Buttons (min 48 px; `.sm` 44 px; all have `:hover` (pointer only), `:active`,
`:focus-visible` (3 px ring), `:disabled`):

```html
<button class="btn">Secondary</button>
<button class="btn primary">Primary</button>
<button class="btn ghost">Ghost</button>
<button class="btn danger">Delete</button>
<button class="btn primary lg block">Big, full width</button>
<button class="btn sm">Small (still 44 px)</button>
```

| Class | What |
| --- | --- |
| `.card` (+ `.flat`) | sheet: surface, hairline, 18 px radius |
| `.btn` `.primary` `.ghost` `.danger` `.sm` `.lg` `.block` `.option` | buttons; `.option` = full-width left-aligned answer |
| `.field` | input / select / textarea (`input.field`); 48 px, 3:1 border, accent focus |
| `.chip` | toggle (`aria-pressed="true"` or `.is-on` = selected); 48 px; always carries an accessible name (its own visible label, or the section `<h2>` via `aria-labelledby`) |
| `.pill` | static label (not interactive) |
| `.progress > span` | progress bar: `<div class="progress" role="progressbar" aria-valuenow=…><span style="width:40%"></span></div>` |
| `.list` + `.list-row` | hairline-separated rows without boxes |
| `.empty` (+ `[data-done]`) | empty / finished state, centred; `data-done` adds a 完 mark |
| `.toast` / `#app-status` | transient message above the tab bar |
| `.tabbar` `.tab` | bottom navigation, 6 tabs, icon + label, readable at 320 px (labels are 11 px on purpose) |
| `.menu` + `.card.field` | **hub / list entry** — see below |
| `.stack` `.cluster` | vertical grid / wrapping row of controls |
| `.hz-cell` `.sm/.md/.lg` | hanzi on the practice grid |
| `.pinyin`, `.hanzi`, `.muted`, `.hint`, `.sr-only` | text helpers |

Hub tiles — CSS only, over the markup `learn.js` / `extras.js` already emit:

```html
<section class="menu"><button class="card field" data-area="tones"><span>Tones</span></button></section>
```

A `.menu` whose entries carry `data-area` becomes a 2-column grid of tiles (3
columns ≥ 40 rem) with a hanzi emblem chosen **by CSS from `data-area`** (课 调
拼 笔 句 题 听 玩 部 难 法 / 我 数 贴 画 说 设 备). A new area needs one line:
`.menu > [data-area="new"].card.field::before { content: "字" / ""; }`. Without
`data-area` (lesson list, reading list) the same markup is a row: title, a
second `<span>` (status pill / topic) below it, a drawn chevron on the right.

### The hanzi cell

```js
import { hanziCell } from '../hanzi.js';
hanziCell('谢谢', 'lg');        // <span class="hz-cell lg" style="--n:2">谢谢</span>
```

`--n` is the character count (one grid tile per character; the cell shrinks so
`n` tiles never overflow 320 px). Use `.lg` for the one hanzi a screen is about
(review card, word of the day), `.md` for lesson vocabulary, `.sm` in dense
spots. Lists with many hanzi (dictionary) use plain `.dict-hanzi` text, not a
cell: the grid is for focus. `.lg` runs the single entrance animation.

Pinyin: always `pinyinHtml()` (src/tone.js) inside `.pinyin`; it emits
`.tone1…5`, which `tone.js` maps to the `--tone` tokens.

### Exercise kit (`exercise-ui.css.js`)

`.options` + `.btn.option` (add `.hz` when the option is hanzi), states
`.is-correct` / `.is-wrong` / `.is-missed` on the option buttons,
`.answer-row` (`.is-ok` / `.is-bad`) + `.pool-row` + `.chip`, `.match-grid` with
`.match-chip` (`.selected`, `.matched`, `data-match="1…6"`), `.feedback.ok|bad`,
`.feedback-box`. Right = jade wash + ✓, wrong = red wash + ✕ + a short shake;
colour is never the only signal.

## 4. Screens (patterns, not a gallery)

- **Home** — one primary action on the desk (no box), daily goal as a bar, the
  word of the day is the only sheet, hanzi `.lg`.
- **Dictionary** — big search field, hairline rows: hanzi 2.25 rem · pinyin ·
  meanings (at most three, `distinctDefs` drops near-duplicates) · a `Trazos:`
  label followed by one boxed chip per character linking to Strokes (44 px).
- **Review** — mode chips, each with a one-line hint under it (wrap, never
  scroll), the card is a sheet with an
  `.lg` cell; back = pinyin 1.75 rem + meaning; four rating buttons
  (`again` red, `good`/`easy` jade) with the interval under the label (2 × 2 at ≤ 22 rem).
- **Lesson** — intro (sheet), vocabulary (rows with `.md` cell, example behind a
  jade rule), exercise (sheet + progress bar), result (score + bar).
- **Read** — a hairline row per reading in the shared `.menu` + `.card.field`
  entry (Chinese title, its pinyin and topic on the second line, the drawn
  chevron on the right); each line of a reading is a hairline row: speaker pill,
  tappable words (dotted underline, 44 px high), optional pinyin, translation,
  round play button; tapping a word opens a bottom sheet above the tab bar.
- **Strokes** — "Ver trazos" (the same wording as the calligraphy sheet) and the
  practice grid is the same dotted 田字格 as `.hz-cell`. Empty state: one hint
  line and three example characters (你 好 妈) that open their sheet. On a sheet
  each character carries `lang="zh-Hans"`, its gloss in the UI language (the
  English CC-CEDICT defs and the etymology's English component gloss are
  labelled "in English" when there is no translation) and the approximate
  stroke types folded behind a `<details>`.

## 5. Motion

One orchestrated moment: `.screen > *` fades in (200 ms, opacity only, so
`position: fixed` children never break) and `.hz-cell.lg` "inks in" (blur
5 px → sharp, 550 ms). Touch feedback: `:active` scale 0.98, right answer
"pop", wrong answer "shake", the word sheet slides up, the toast rises.
Under `prefers-reduced-motion: reduce` every entrance animation and transition
is effectively off (1 µs); only the border/fill change that marks a right or
wrong answer stays, without the shake or pop. Do not add hover transitions on
every card or scroll-triggered entrances.

## 6. Rules of use for other tasks

1. Use the shared classes; do not restyle `.btn`, `.card`, `.field`, `.chip` in a module. Module CSS may only lay out *its own* parts (grid, gaps) using tokens.
2. No colours, shadows or font sizes in `style="…"`; no `text-transform: uppercase`; no `→` in button text; no `<h2>` eyebrows above headings.
3. Targets ≥ 44 × 44 px (`.btn` 48). Inline words inside running text (`.word`) are the one exemption.
4. Text ≥ 4.5:1 (large ≥ 3:1), boundaries of fields/buttons ≥ 3:1. Use `--ink-soft` for secondary text, never opacity.
5. One hanzi `.lg` per screen at most. Keep copy short: es text is ~25 % longer than en, so no fixed widths, let it wrap (`min-width: 0`).
6. Settings contract unchanged: `theme`, `fontScale`, `toneColors`, `dailyGoal`; modules never read them to style, the tokens react.
7. New screen checklist: run `check-contrast.mjs` (add the route to `scripts/lib/audit.mjs`), look at 320 px es, dark.
8. Default margins of `.screen p` / `.screen h2` are zero-specificity (`:where`): a single class always wins over them.
9. Optional or long content goes behind a `<details>` disclosure (More › Tools, the lesson vocabulary past the first four rows, the approximate stroke types); the `<summary>` row is a ≥ 44 px target. Hub blocks stay at ≤ 4 tiles each.

## 7. Status

Every Learn and More screen uses the tokens and shared classes (t_756e8edf,
t_ca3458fa). Controls are >= 44 px with a 3:1 border (`--edge`); `--line` is
decoration only. Audited by `check-contrast.mjs` (all `AREAS` routes) and
`check-layout.mjs`.

Round 3 (t_3e479afd, `docs/DESIGN-REVIEW-2.md`) applied the review findings:
at most four tiles per hub block, the More tools folded behind `<details>`,
`<details>` disclosures for long optional content, the pinyin header toggle as
a shared `.chip` with `aria-pressed` and an accessible name, `lang="zh-Hans"`
on every standalone hanzi, Spanish glosses (or an "in English" label) on the
stroke sheet, "Games" instead of "Memory games", and no developer paths
(`docs/SYNC.md`) in the UI.

## 8. Checks

```
OUT_DIR=/tmp/chino-<id> npm run build
node scripts/check-contrast.mjs /tmp/chino-<id>                          # all main flows, 390 + 320, light + dark, en + es
SHOTS_DIR=/tmp/chino-<id>/shots node scripts/check-contrast.mjs <dir>    # also save screenshots
ONLY=home,review WIDTHS=320 THEMES=dark LOCALES=es node scripts/check-contrast.mjs <dir>
FONTSCALE=1.3 node scripts/check-contrast.mjs <dir>                      # largest text size
node scripts/check-layout.mjs <dir>                                      # hanzi/pinyin/english stacking, overflow
```

`check-contrast.mjs` asserts, from the real DOM and with touch emulation: text
contrast (AA), 3:1 boundaries of fields/buttons/chips, 44 px targets, no
horizontal overflow, the five tone colours on every surface in both themes,
that the settings toggles (theme, font scale) change the page, that Onest
loads, that nothing is requested from another origin, and that
`prefers-reduced-motion` stops the entrance animation.

Screenshots of the redesign: `docs/design-shots/`.
