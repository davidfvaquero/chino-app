# Lesson schema

How the lesson engine (`src/learn/lessons.js`) reads data and how exercises are
graded (`src/learn/exercises.js`). Data lives under `public/data/lessons/` and is
served at `/data/lessons/…`; the engine is level-agnostic — it reads
`public/data/lessons/<level>/index.json` for any `<level>`.

```
public/data/lessons/
  hsk1/
    index.json          # the 10-lesson plan for the level
    lesson-01.json      # one file per lesson
    lesson-02.json      # (written by the filler tasks)
    …
  hsk4/
    index.json          # the 20-lesson plan for the level (598 words, 30 per lesson)
    lesson-01.json      # one file per lesson (to be written)
    lesson-02.json
    …
```

## 1. `index.json` (the plan)

```jsonc
{
  "level": "hsk1",
  "title": "HSK 1",
  "source": "public/data/hsk/1.json",   // where the words come from
  "wordCount": 150,
  "wordsPerLesson": 15,
  "lessons": [
    {
      "id": "hsk1-01",                  // unique, stable; also the route segment
      "title": "Greetings & numbers",   // i18n key OR literal English text
      "file": "lesson-01.json",         // file inside <level>/
      "range": { "from": 1, "to": 15 }, // suggested slice of the level's word list (1-based, inclusive)
      "curated": true                   // optional: hand-written, `range` is only a reservation
    }
  ]
}
```

- The HSK1 word list (`public/data/hsk/1.json`) is alphabetical, so `range` is a
  positional slice, not a theme. `range` is a hint for the lessons that are
  still to be written; the filler tasks write `lesson-02.json … lesson-10.json`
  and **do not touch `index.json`**.
- A lesson marked `curated: true` is already written by hand: its
  `vocabulary` is authoritative and `range` is just the reserved slot.
- `title` may be a translation key (`t()` resolves it) or a plain string; the
  engine renders whatever `t(title)` returns, falling back to the string itself.

## 2. `lesson-<nn>.json` (one lesson)

```jsonc
{
  "id": "hsk1-01",
  "title": "Greetings & numbers",   // key or literal text
  "intro": "Say hello and goodbye…",// short English explanation, one or two sentences
  "vocabulary": [
    {
      "hanzi": "你",
      "pinyin": "nǐ",
      "english": "you (singular)",
      "example": { "hanzi": "你好", "pinyin": "nǐ hǎo", "english": "hello" }
    }
  ],
  "exercises": [ /* see §3 */ ]
}
```

- `vocabulary[].english` is a single string (unlike the dictionary's `defs[]`).
- `example` is optional but recommended; the vocabulary step renders
  `hanzi · pinyin · english`.
- Every vocabulary word gets an **"Add to review"** button that calls
  `srs.addToReview({ hanzi, pinyin, english, source: 'lesson' })` (idempotent).

## 3. Exercises

Four types, all graded by the pure `gradeExercise(exercise, response)` in
`src/learn/exercises.js` (see §4). `prompt` is display text (data, not a UI key).

```jsonc
// choose — pick one option
{ "type": "choose", "prompt": "What does 谢谢 mean?",
  "options": ["thank you", "goodbye"], "answer": "thank you" }

// listen — like choose, but the UI plays `audio` through src/audio.js first
{ "type": "listen", "audio": "你好", "pinyin": "nǐ hǎo",
  "prompt": "Listen and choose what you hear.",
  "options": ["你好", "再见"], "answer": "你好" }

// match — pair every left item with its right item
{ "type": "match", "prompt": "Match each word to its meaning.",
  "pairs": [{ "hanzi": "你", "english": "you" },
            { "hanzi": "再见", "english": "goodbye" }] }

// order — arrange `tokens` into the correct sequence
{ "type": "order", "prompt": "Make 'five people'.",
  "tokens": ["个", "人", "五"], "answer": "五个人" }
```

## 4. Grading contract

`gradeExercise(exercise, response)` is pure (no DOM, no storage, no audio) and
returns:

```js
{ type, correct, score, expected, given }
```

| type | `response` | `correct` when | `score` |
| --- | --- | --- | --- |
| `choose` / `listen` | the chosen option (string) | `response === answer` (non-empty) | 1 or 0 |
| `order` | array of tokens (or a joined string) | `response.join('') === answer.join('')` | 1 or 0 |
| `match` | `{ left: right }` map, or `[left, right]` / `{left, right}` pairs | every declared pair matched | `matched / pairs.length` |

An unknown `type` throws a `TypeError` (same style as `src/srs.js` rejecting a
bad rating). `summarize(results)` turns a list of results into
`{ correct, total, score }` (mean of per-exercise scores).

## 5. Lesson flow and progress

The lesson screen is a step machine: **intro → vocabulary → exercises → result**.

- Progress is persisted **after every answered exercise** in the storage store
  `progress`, key `<level>:<id>` (e.g. `hsk1:hsk1-01`), so partial progress
  survives a reload:
  `{ completed, score, total, answered, updatedAt }`.
- Finishing the last exercise marks `completed: true` and fires the
  cross-module DOM event **`chino:lesson_done`** on `window` with
  `detail: { level, lessonId, score, total }`.
- The list screen shows `Start`, `In progress · n/total`, or `Completed · s/total`.

## 6. Engine API (`src/learn/lessons.js`)

```js
titleKey                                         // 'hubs.learn.lessons'
DEFAULT_LEVEL                                    // 'hsk1'
loadIndex(level, { base, fetchJson })            // -> { level, lessons[] }
loadLesson(level, lessonId, { base, fetchJson }) // -> lesson object
getProgress(level, lessonId, { store })          // -> record | null
saveProgress(level, lessonId, patch, { store })  // -> merged record
render(container, ctx)                           // #/learn/lessons and #/learn/lessons/<id>
```

`base` / `fetchJson` / `store` are injectable so the engine is unit-tested in
Node against the real files under `public/data/lessons/` (see
`tests/exercises.test.mjs`).
