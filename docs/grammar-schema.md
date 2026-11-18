# Grammar schema

How the grammar screen (`src/learn/grammar.js`, route `#/learn/grammar`) reads
its data. Everything lives under `public/data/grammar/` and is served at
`/data/grammar/…`. The files are hand-written JSON (not generated), so this
document is the contract.

```
public/data/grammar/
  index.json          # the 15 pre-defined beginner patterns (id + title)
  pattern-01.json     # one file per written pattern
  pattern-02.json
  measure-words.json  # the 25 common classifiers
```

## 1. `index.json` (the plan)

```jsonc
{
  "level": "beginner",
  "patterns": [
    {
      "id": "shi",                 // unique, stable; also the route segment
      "title": "是 — to be",       // shown in the list (data text, not a UI key)
      "level": "HSK1",             // short level label, shown as a pill
      "file": "pattern-01.json"    // optional: file inside this directory
    }
  ]
}
```

- `id` is unique and used as the route segment (`#/learn/grammar/shi`).
- A pattern **without** `file` is only planned: the list shows it, opening it
  shows the "not written yet" note. Pattern files are added by filler tasks,
  which **only** add `file` entries for their own pattern — never rewrite
  `index.json` wholesale.
- `title` is data text (like a lesson title): translated strings are not
  required. UI chrome always comes from `t('grammar.*')`.

## 2. `pattern-<nn>.json` (one pattern)

```jsonc
{
  "id": "shi",
  "title": "是 — to be",
  "level": "HSK1",
  "explanation": "Use 是 to link two nouns: A 是 B means “A is B”.",  // short, English
  "structure": "Subj + 是 + Noun",                                  // the pattern skeleton
  "examples": [
    { "hanzi": "我是学生。", "pinyin": "wǒ shì xuéshēng", "english": "I am a student." }
  ],
  "notes": "For adjectives use 很, never 是."                          // optional
}
```

- Every `examples[]` item has `hanzi` (simplified only), `pinyin` (tone marks,
  space-separated syllables so `pinyinHtml()` can colour each one) and
  `english`.
- Each example gets a **Hear it** button (`speak(hanzi)`, `src/audio.js`) and an
  **Add to review** button (`addToReview({hanzi, pinyin, english, source:
  'grammar'})`, idempotent).
- The pattern screen has a **Mark as studied** button: it stores the id under
  `progress` / `grammar:studied` and fires `chino:lesson_done` on `window` with
  `detail: { lessonId: 'grammar', patternId, studied }`.

## 3. `measure-words.json`

```jsonc
{
  "measureWords": [
    {
      "character": "个",
      "pinyin": "gè",
      "usage": "general measure word for people and things",
      "examples": [
        { "hanzi": "一个人", "pinyin": "yí gè rén", "english": "one person" },
        { "hanzi": "三个苹果", "pinyin": "sān gè píngguǒ", "english": "three apples" }
      ]
    }
  ]
}
```

25 classifiers, each with a **usage** line and **2 examples**. The Measure words
section renders `character · pinyin · usage` plus the two examples, with the
same audio / add-to-review controls as patterns.

## 4. Engine API (`src/learn/grammar.js`)

```js
titleKey, LESSON_ID, PROGRESS_STORE, STUDIED_KEY, MEASURE_SEGMENT, DATA_BASE
isValidExample(example) / isValidPattern(pattern) / isValidMeasureWord(word)
isValidIndexEntry(entry) / normalizePattern(raw)
loadIndex({ base, fetchJson })                 // -> [{id,title,level,file?}]
loadPattern(id, { base, fetchJson, index })    // -> pattern | null (null = not written)
loadMeasureWords({ base, fetchJson })          // -> [{character,pinyin,usage,examples}]
getStudied({ store }) / markStudied(id, { store, now, notify })
render(container, ctx)                         // #/learn/grammar[/*]
```

`base` / `fetchJson` / `store` are injectable so the validation tests run in
Node against the real files under `public/data/grammar/` and an in-memory
storage (`tests/grammar.test.mjs`).
