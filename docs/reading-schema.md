# Reading schema

Graded readings for the Read screen. Files live under
`public/data/readings/<level>/` (this task owns `hsk1/`), are copied verbatim
into the site root by the build, and are fetched at runtime as
`/data/readings/<level>/<id>.json`.

## Index — `public/data/readings/hsk1/index.json`

A flat array with one entry per reading. The forty entries are **pre-defined**:
the first six (`reading-01` … `reading-06`) already have their JSON file, and
other tasks write `reading-07.json` … `reading-40.json` with the id/title/topic
already listed here. Nobody but the index owner edits this file.

```json
[
  { "id": "reading-01", "title": "你好！", "topic": "Greetings & introductions" },
  { "id": "reading-02", "title": "我的家", "topic": "Family" }
]
```

| Field   | Type   | Required | Notes                                            |
| ------- | ------ | -------- | ------------------------------------------------ |
| `id`    | string | yes      | Also the file name: `reading-01` → `reading-01.json` |
| `title` | string | yes      | Short label shown in the list (hanzi is fine)    |
| `topic` | string | yes      | One-line theme, shown as the card subtitle       |

The list order is the file order. No other fields are read by the screen. An id
whose file is still missing is listed normally (the reader shows "coming soon"
if you open it), so the index can run ahead of the content tasks.

## Reading — `public/data/readings/hsk1/<id>.json`

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

- `dictionary.segment(hanzi)` splits a line into word tokens; every token that
  contains a hanzi is tappable.
- Tapping a token runs `dictionary.lookup(token)` and shows a panel with the
  pinyin and English definitions.
- The panel's "add to review" button calls
  `srs.addToReview({ id, hanzi, pinyin, pinyinNumeric, english, source: 'reading' })`.
- The pinyin line is hidden by default and shown with the "Pinyin" toggle.
- Each line has a speaker button (`audio.speak(hanzi)`); the whole reading can be
  marked done, which fires the `chino:reading_done` window event.
