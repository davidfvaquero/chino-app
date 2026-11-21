# Reading schema

Graded readings for the Read screen, in three levels: `hsk1`, `hsk2` and `hsk3`.
A level is a directory — `public/data/readings/<level>/` — copied verbatim into
the site root by the build and fetched at runtime as
`/data/readings/<level>/<id>.json` (language-aware: `data/es/readings/<level>/…`
when translated, English otherwise). `hsk1` is the default level.

## Index — `public/data/readings/<level>/index.json`

A flat array with one entry per reading, all **pre-defined**: the content tasks
write `reading-NN.json` with the id/title/pinyin/topic already listed here.
Nobody but the index owner edits this file. `hsk1` has 40 entries; `hsk2` and
`hsk3` have 20 each (`reading-01` … `reading-20`), mixing dialogues and short
texts around the level's themes (HSK2: shopping, time, transport, health, plans;
HSK3: travel, work, studies, opinions, descriptions).

```json
[
  { "id": "reading-01", "title": "你好！", "pinyin": "nǐ hǎo", "topic": "Greetings & introductions" },
  { "id": "reading-02", "title": "我的家", "pinyin": "wǒ de jiā", "topic": "Family" }
]
```

| Field     | Type   | Required | Notes                                            |
| --------- | ------ | -------- | ------------------------------------------------ |
| `id`      | string | yes      | Also the file name: `reading-01` → `reading-01.json` |
| `title`   | string | yes      | Short label shown in the list (hanzi)            |
| `pinyin`  | string | no       | Tone-marked title, shown under it when present   |
| `topic`   | string | yes      | One-line theme in English, shown as the subtitle |

The list order is the file order. No other fields are read by the screen. An id
whose file is still missing is listed normally (the reader shows "coming soon"
if you open it), so the index can run ahead of the content tasks.

## Vocabulary rule

Every hanzi in `lines[].hanzi` must belong to the HSK vocabulary of the
reading's level **or lower** (`public/data/hsk/1.json` … `3.json`): an `hsk2`
reading uses HSK1+HSK2 characters, an `hsk3` reading HSK1..3. Punctuation and
the short proper-name allowlist in `tests/readings-levels.test.mjs` are the only
exceptions. The 40 pre-existing `hsk1` readings predate the rule and are
grandfathered there; new files must comply.

## Reading — `public/data/readings/<level>/<id>.json`

```json
{
  "id": "reading-01",
  "title": "你好！",
  "type": "dialogue",
  "topic": "Greetings & introductions",
  "lines": [
    {
      "speaker": "A",
      "hanzi": "你好！你叫什么名字？",
      "pinyin": "Nǐ hǎo! Nǐ jiào shénme míngzi?",
      "english": "Hello! What's your name?"
    }
  ]
}
```

| Field   | Type   | Required | Notes                                                     |
| ------- | ------ | -------- | --------------------------------------------------------- |
| `id`    | string | yes      | Must equal the index id and the file name                 |
| `title` | string | yes      | Heading in the reader                                     |
| `type`  | string | yes      | `"text"` (prose) or `"dialogue"` (speakers). Default `"text"` |
| `topic` | string | no       | Same value as in the index; informational                  |
| `lines` | array  | yes      | One entry per line/paragraph, rendered in order            |

### Line object

| Field     | Type   | Required | Notes                                                |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `speaker` | string | no       | Only for `type: "dialogue"` (e.g. `"A"`, `"老板"`)    |
| `hanzi`   | string | yes      | The Chinese text. This is what gets segmented and spoken |
| `pinyin`  | string | yes      | Tone-marked reading of the whole line                |
| `english` | string | yes      | Full-line translation                                |

`normalizeReading()` (`src/reading/model.js`) fills every optional field with an
empty string and coerces `type` to `text` unless it is exactly `dialogue`, so a
partially-filled file still renders.

## How the reader uses it

- The screen has a level picker (HSK 1 / 2 / 3, same style as the lessons
  picker). The chosen level is written to the `readingLevel` setting, so the
  list opens on the last level used; `#/read?level=hsk2` selects it directly and
  the old `#/read` / `#/read/<id>` links keep working (stored level, hsk1 by
  default).
- `dictionary.segment(hanzi)` splits a line into word tokens; every token that
  contains a hanzi is tappable.
- Tapping a token runs `dictionary.lookup(token)` and shows a panel with the
  pinyin and English definitions.
- The panel's "add to review" button calls
  `srs.addToReview({ id, hanzi, pinyin, pinyinNumeric, english, source: 'reading' })`.
- The pinyin line is hidden by default and shown with the "Pinyin" toggle.
- Each line has a speaker button (`audio.speak(hanzi)`); the whole reading can be
  marked done, which fires the `chino:reading_done` window event (detail
  `{ id, title, level }`) — gamification records it as `reading_done`.
