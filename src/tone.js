/**
 * tone.js — Pinyin tone coloring helper (no UI, no dependencies).
 *
 * Public API:
 *   pinyinHtml(pinyin)   -> safe HTML string, one <span class="tone tone1..5"> per syllable
 *   toneOf(syllable)     -> 1..5 | null  (5 = neutral tone)
 *   isToneColorsOn()     -> boolean (settings.toneColors, default true)
 *   setToneColors(on)    -> update the cached flag (+ <html> class); used by the
 *                           'chino:settings_changed' listener and by tests
 *
 * Accepts pinyin with tone marks ("nǐ hǎo") or tone numbers ("ni3 hao3").
 * A syllable with no tone info ("ma") counts as neutral (tone5). A glued run
 * with no separators ("nihao") stays a single, uncolored syllable: we cannot
 * split it safely. HTML is escaped. When colors are off, returns plain escaped
 * text. CSS is injected once with accessible colors for light/dark themes.
 * Listens for 'chino:settings_changed' and toggles .tone-colors-off on <html>.
 */

import storage from './storage.js';

const STYLE_ID = 'tone-colors-style';

/** Tone mark -> tone number (1-4). Lower + upper case, all five vowels. */
const TONE_MARK_TO_NUM = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
  'Ā': 1, 'Á': 2, 'Ǎ': 3, 'À': 4,
  'Ē': 1, 'É': 2, 'Ě': 3, 'È': 4,
  'Ī': 1, 'Í': 2, 'Ǐ': 3, 'Ì': 4,
  'Ō': 1, 'Ó': 2, 'Ǒ': 3, 'Ò': 4,
  'Ū': 1, 'Ú': 2, 'Ǔ': 3, 'Ù': 4,
  'Ǖ': 1, 'Ǘ': 2, 'Ǚ': 3, 'Ǜ': 4,
};

/** Normalize 'v'/'V' -> 'ü'/'Ü' and 'u:'/'U:' -> 'ü'/'Ü'. */
function normalizeUmlaut(s) {
  return s.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');
}

/** Split pinyin into syllables on whitespace. */
function splitSyllables(pinyin) {
  return String(pinyin).trim().split(/\s+/).filter(Boolean);
}

/** Tone from tone marks. Returns 1-4, or null if the syllable carries no mark. */
function toneFromMarks(syllable) {
  for (const ch of syllable) {
    if (TONE_MARK_TO_NUM[ch]) return TONE_MARK_TO_NUM[ch];
  }
  return null;
}

/** Tone from a trailing number (ni3, hao3, ma5). Returns 1-5, or null. */
function toneFromNumber(syllable) {
  const m = syllable.match(/([1-5])$/);
  return m ? Number(m[1]) : null;
}

/** Strip a trailing tone number (ni3 -> ni). */
function stripToneNumber(syllable) {
  return syllable.replace(/[1-5]$/, '');
}

/** Tone of one syllable: 1-5 (5 = neutral), or null if not a valid syllable. */
function detectTone(syllable) {
  const norm = normalizeUmlaut(String(syllable ?? '').trim());
  if (!norm) return null;
  const num = toneFromNumber(norm);
  if (num !== null) return num;
  const mark = toneFromMarks(norm);
  if (mark !== null) return mark;
  return 5; // no explicit tone -> neutral
}

/** True when the syllable carries explicit tone info (marks or number). */
function hasExplicitTone(syllable) {
  const norm = normalizeUmlaut(String(syllable ?? '').trim());
  if (!norm) return false;
  return toneFromNumber(norm) !== null || toneFromMarks(norm) !== null;
}

/** Escape HTML special chars so pinyin can never inject markup. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tone colors (injected once). The colours live in src/styles.css as --tone1..5
 *  (one light-dark() token each, AA on every surface); this only maps class -> token. */
const CSS = `
.tone { display: inline; }
.tone1 { color: var(--tone1); }
.tone2 { color: var(--tone2); }
.tone3 { color: var(--tone3); }
.tone4 { color: var(--tone4); }
.tone5 { color: var(--tone5); }
html.tone-colors-off .tone { color: inherit; }
`;

/** Inject the CSS into <head> once. */
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Cached toneColors setting (default true). */
let toneColorsCache = true;
let cacheInitialized = false;

/** Read settings.toneColors from storage (default true). */
async function readToneColors() {
  try {
    const value = await storage.get('settings', 'toneColors');
    return value !== false;
  } catch {
    return true;
  }
}

/** Apply/remove .tone-colors-off on <html>. */
function applyHtmlClass() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('tone-colors-off', !toneColorsCache);
}

/**
 * Update the cached flag and the <html> class.
 * The settings listener and tests use this; it also marks the cache as
 * initialized so a pending async load cannot overwrite an explicit choice.
 */
export function setToneColors(on) {
  toneColorsCache = on !== false;
  cacheInitialized = true;
  applyHtmlClass();
}

/** Load the stored setting once (browser bootstrap). */
async function initCache() {
  if (cacheInitialized) return;
  cacheInitialized = true;
  toneColorsCache = await readToneColors();
  applyHtmlClass();
}

/** Tone of a single syllable: 1-5 (5 = neutral), or null if invalid. */
export function toneOf(syllable) {
  if (syllable == null) return null;
  return detectTone(syllable);
}

/** True when tone colors are enabled. */
export function isToneColorsOn() {
  return toneColorsCache;
}

/**
 * Convert pinyin to safe HTML with tone-colored spans.
 * @param {string} pinyin - 'nǐ hǎo' | 'ni3 hao3' | 'nihao'
 * @returns {string} escaped HTML, one <span class="tone toneN"> per syllable
 */
export function pinyinHtml(pinyin) {
  const body = pinyinBody(pinyin);
  // `.py` is the one hook the global "show pinyin" setting hides (styles.css).
  return body ? `<span class="py">${body}</span>` : '';
}

function pinyinBody(pinyin) {
  const input = pinyin ?? '';
  if (!input) return '';

  if (!toneColorsCache) return escapeHtml(String(input));

  const syllables = splitSyllables(input);
  if (!syllables.length) return '';

  // A single glued syllable with no tone info cannot be split -> leave plain.
  const ambiguous = syllables.length === 1 && !hasExplicitTone(syllables[0]);

  const parts = syllables.map((syl) => {
    const display = escapeHtml(normalizeUmlaut(stripToneNumber(syl)));
    if (ambiguous) return display;
    const tone = detectTone(syl);
    return tone >= 1 && tone <= 5 ? `<span class="tone tone${tone}">${display}</span>` : display;
  });

  return parts.join(' ');
}

// Browser bootstrap: inject CSS, load the setting, listen for changes.
if (typeof window !== 'undefined') {
  if (typeof document !== 'undefined') ensureStyles(document);
  window.addEventListener('chino:settings_changed', (e) => {
    if (e.detail?.key === 'toneColors') setToneColors(e.detail.value);
  });
  initCache();
}
