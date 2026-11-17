/**
 * reading/model.js — pure reader logic (no DOM, no fetch, no i18n).
 *
 * Everything the Read screen needs to turn a reading JSON into a view model
 * lives here, so it is testable in Node without a browser:
 *   normalizeReading(raw)            -> { id, title, type, topic, lines[] }
 *   tokenizeLine(hanzi, segmentFn)   -> [{ text, word }]  (segmentFn = dictionary.segment)
 *   wordPanel(token, entry)          -> panel view model for a tapped word
 *   reviewEntryFrom(entry, source)   -> entry shaped for srs.addToReview()
 *
 * See docs/reading-schema.md for the file format.
 */

const HANZI_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

/** True when the string contains at least one hanzi character. */
export function hasHanzi(text) {
  return HANZI_RE.test(String(text ?? ''));
}

/** Coerce a raw reading JSON into a fully-populated object (missing = ""). */
export function normalizeReading(raw = {}) {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    type: raw.type === 'dialogue' ? 'dialogue' : 'text',
    topic: String(raw.topic ?? ''),
    lines: lines.map((line) => ({
      speaker: String(line?.speaker ?? ''),
      hanzi: String(line?.hanzi ?? ''),
      pinyin: String(line?.pinyin ?? ''),
      english: String(line?.english ?? ''),
    })),
  };
}

/**
 * Split one hanzi line into display tokens using a segment function.
 * `word: true` marks a tappable token (it has hanzi, so a lookup may succeed);
 * punctuation, spaces and latin pass through as `word: false`.
 */
export async function tokenizeLine(hanzi, segment) {
  const parts = await segment(String(hanzi ?? ''));
  return (Array.isArray(parts) ? parts : []).map((text) => ({
    text: String(text),
    word: hasHanzi(text),
  }));
}

/** View model for the tap-a-word panel. `entry` is a dictionary.lookup() result. */
export function wordPanel(token, entry) {
  if (!entry) return { hanzi: String(token ?? ''), found: false, pinyin: '', english: [] };
  return {
    hanzi: entry.simp ?? entry.hanzi ?? String(token ?? ''),
    trad: entry.trad ?? '',
    pinyin: entry.pinyinTone ?? entry.pinyin ?? '',
    english: Array.isArray(entry.defs) ? entry.defs : [],
    id: entry.id,
    found: true,
  };
}

/** Map a dictionary entry to the shape srs.addToReview() expects. */
export function reviewEntryFrom(entry = {}, source = 'reading') {
  return {
    id: entry.id,
    hanzi: entry.simp ?? entry.hanzi ?? '',
    trad: entry.trad ?? entry.simp ?? entry.hanzi ?? '',
    pinyin: entry.pinyinTone ?? entry.pinyin ?? '',
    pinyinNumeric: entry.pinyinNum ?? entry.pinyinNumeric ?? '',
    english: Array.isArray(entry.defs) ? entry.defs : entry.english ?? [],
    source,
  };
}
