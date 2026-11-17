# Themes schema — vocabulary & phrase groups

One JSON file per theme under `public/data/themes/`, plus a fixed index.
Owner: `t_99266dfe` (`src/learn/themes.js`). Runtime URL: `/data/themes/…`.

## `index.json` — fixed list of 12 themes

A bare array. **Never change ids or order**; filler tasks only add
`theme-03.json` … `theme-12.json` (they do not touch the index).

```json
[
  { "id": "theme-01", "title": "Greetings & politeness", "icon": "👋" },
  { "id": "theme-04", "title": "Restaurant", "icon": "🍜", "travel": true }
]
```

| field | type | required | meaning |
| --- | --- | --- | --- |
| `id` | string | yes | file name without `.json`; `theme-01` … `theme-12` |
| `title` | string | yes¹ | list label (plain string, not translated) |
| `titleKey` | string | yes¹ | alternative to `title`: i18n key resolved with `t()` |
| `icon` | string | no | emoji shown in the tile |
| `travel` | boolean | no | shows a "Travel" badge (restaurant / transport / hotel / directions) |

¹ one of `title` or `titleKey` is required.

Theme ids in order: `theme-01` greetings & politeness, `theme-02` family,
`theme-03` food & drink, `theme-04` restaurant, `theme-05` shopping,
`theme-06` transport & travel, `theme-07` hotel, `theme-08` directions &
places, `theme-09` health, `theme-10` school & work, `theme-11` weather,
`theme-12` hobbies.

A theme without a file is not an error: the screen shows a "not ready yet"
panel. This is how 03–12 stay visible before they are written.

## `theme-NN.json` — one theme

```json
{
  "id": "theme-01",
  "title": "Greetings & politeness",
  "icon": "👋",
  "words": [
    { "hanzi": "你好", "pinyin": "nǐ hǎo", "english": "hello" }
  ],
  "phrases": [
    { "hanzi": "你好吗？", "pinyin": "nǐ hǎo ma", "english": "how are you?" }
  ]
}
```

| field | type | required | meaning |
| --- | --- | --- | --- |
| `id` | string | yes | must equal the file name |
| `title` / `titleKey` | string | yes | shown as the screen heading |
| `icon` | string | no | emoji |
| `words` | array | yes | vocabulary entries |
| `phrases` | array | yes | full sentences; the travel themes put the useful ones here |

Entry (`words[]` and `phrases[]` share the shape):

| field | type | required | meaning |
| --- | --- | --- | --- |
| `hanzi` | string | yes | **simplified** Chinese only (no traditional characters) |
| `pinyin` | string | yes | accented pinyin, syllables separated by spaces (`nǐ hǎo`) |
| `english` | string | yes | English meaning / translation |

Rules for filler tasks:

- Simplified characters only. Pinyin with tone marks, never tone numbers.
- Pinyin is rendered by `pinyinHtml()` (`src/tone.js`), so plain spaces between
  syllables are enough — no markup in the data.
- Keep `id` equal to the file name; duplicates inside one theme are dropped by
  `themeCards()` (first wins).
- Review cards are keyed `theme:<hanzi>`, so a word shared by two themes is a
  single card.

## Review & progress

- "Add to review" (row) and "Add whole theme" call `srs.addToReview()` with
  `{id: 'theme:<hanzi>', hanzi, pinyin, english, source: 'theme'}` (idempotent).
- "Mark as studied" stores `progress['theme:<id>'] =
  {themeId, words, phrases, studiedAt}` and dispatches
  `chino:lesson_done` with `detail = {area: 'themes', themeId, words, phrases}`.