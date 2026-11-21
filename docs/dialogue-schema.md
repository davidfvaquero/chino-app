# Dialogue schema — short everyday dialogues

Short two-person dialogues for the **Dialogues** area of the Learn hub
(`#/learn/dialogues`), in three levels: `hsk1`, `hsk2` and `hsk3`. A dialogue is
a conversation of 8–10 lines with per-line audio, tone-marked pinyin and a
translation you can show or hide, plus two practice modes (You are B / Order the
dialogue).

Unlike the readings, the dialogues live in **one flat directory**,
`public/data/dialogues/` — not one per level — and the level is a field on each
index entry, so the screen filters the single list by HSK level. The files are
(fetched as `/data/dialogues/…`; language-aware: `data/es/dialogues/…` when
translated, English otherwise, see `docs/i18n-content.md`).

## Index — `public/data/dialogues/index.json`

A flat array with one entry per dialogue, all **pre-defined**: the content tasks
write `dialogue-NN.json` with the id already listed here. 30 entries:
`dialogue-01` … `dialogue-10` are `hsk1`, `11`…`20` are `hsk2` and `21`…`30`
are `hsk3`. Nobody but the index owner edits this file.

```json
[
  {
    "id": "dialogue-01",
    "title": "你好！",
    "titleEn": "Hello!",
    "topic": "Greetings",
    "level": "hsk1"
  }
]
```

| Field     | Type   | Required | Notes                                                    |
| --------- | ------ | -------- | -------------------------------------------------------- |
| `id`      | string | yes      | Also the file name: `dialogue-01` → `dialogue-01.json`   |
| `title`   | string | yes      | Short label in hanzi, shown in the list                  |
| `titleEn` | string | yes      | English title (translated in the `es` copy)              |
| `topic`   | string | yes      | One-line theme in English, shown as the subtitle         |
| `level`   | string | yes      | `"hsk1"` \| `"hsk2"` \| `"hsk3"`                         |

The list order is the file order, filtered by level on screen. An id whose file
is still missing is listed normally (the screen shows "coming soon" if you open
it), so the index can run ahead of the content tasks.

## Vocabulary rule

Every hanzi in `lines[].zh` must belong to the HSK vocabulary of the dialogue's
level **or lower** (`public/data/hsk/1.json` … `3.json`): an `hsk2` dialogue uses
HSK1+HSK2 characters, an `hsk3` dialogue HSK1..3. Punctuation and the short
proper-name allowlist in `tests/dialogues.test.mjs` are the only exceptions. New
files must comply.

## Dialogue — `public/data/dialogues/<id>.json`

```json
{
  "id": "dialogue-01",
  "title": "你好！",
  "titleEn": "Hello!",
  "topic": "Greetings",
  "level": "hsk1",
  "lines": [
    {
      "speaker": "A",
      "zh": "你好！",
      "pinyin": "Nǐ hǎo!",
      "en": "Hello!"
    }
  ]
}
```

| Field     | Type   | Required | Notes                                                     |
| --------- | ------ | -------- | --------------------------------------------------------- |
| `id`      | string | yes      | Must equal the index id and the file name                  |
| `title`   | string | yes      | Same value as in the index (hanzi)                        |
| `titleEn` | string | yes      | Same value as in the index                                |
| `topic`   | string | yes      | Same value as in the index                                |
| `level`   | string | yes      | Same value as in the index                                |
| `lines`   | array  | yes      | One entry per line, in speaking order                     |

### Line object

| Field     | Type   | Required | Notes                                                    |
| --------- | ------ | -------- | -------------------------------------------------------- |
| `speaker` | string | yes      | `"A"` or `"B"`, strictly **alternating** from A          |
| `zh`      | string | yes      | The Chinese text (simplified). This is what gets spoken  |
| `pinyin`  | string | yes      | Tone-marked reading of the whole line                    |
| `en`      | string | yes      | Full-line translation (Spanish in the `es` copy)         |

`normalizeDialogue()` (`src/learn/dialogues.js`) fills every optional field with
an empty string, so a partially-filled file still renders.

## How the screen uses it

- The list filters the index by HSK level (a picker, `hsk1` by default, stored
  in the `dialogueLevel` setting).
- Each line is an A/B **bubble** (A left, B right) with its pinyin (a `.py`
  span from `pinyinHtml()`, so the global pinyin switch hides it) and its
  translation (`en`, or Spanish under locale `es`), which the "Translation"
  toggle shows or hides. Tapping a bubble plays the line.
- **Play all** alternates A/B; B is spoken at a slightly different rate, so the
  two voices differ when the dialogue has both speakers.
- **You are B** hides every B line, then walks the B turns: the previous A line
  is shown as the prompt and the student picks the right reply from three
  options — the real B line plus two distractors taken from other lines.
- **Order the dialogue** shuffles the lines and the student taps them back into
  order.
- **Add words to review** segments every line and sends each word to
  `srs.addToReview()` (source `'dialogue'`).
- **Mark as done** stores `dialogue:<id>` in the `progress` store and fires the
  `chino:dialogue_done` window event (detail `{ id, title, level }`).
