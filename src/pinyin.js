// Pinyin helpers (dependency-free, browser + Node).
//
// Self-contained twin of scripts/lib/pinyin.mjs (src/ cannot import from
// scripts/ at runtime — the build only copies src/ and public/). Keep the two
// in sync if the tone-placement rules ever change.
//
// CC-CEDICT ships pinyin with *tone numbers* ("ni3 hao3"); the app shows tone
// marks ("nǐ hǎo") and searches on a separator-free toneless key ("nihao").
// Tone-mark placement: a > o > e, else the last vowel of the syllable.

const MARKS = {
  a: ['ā', 'á', 'ǎ', 'à'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  A: ['Ā', 'Á', 'Ǎ', 'À'],
  O: ['Ō', 'Ó', 'Ǒ', 'Ò'],
  E: ['Ē', 'É', 'Ě', 'È'],
  I: ['Ī', 'Í', 'Ǐ', 'Ì'],
  U: ['Ū', 'Ú', 'Ǔ', 'Ù'],
  Ü: ['Ǖ', 'Ǘ', 'Ǚ', 'Ǜ'],
};

const STRIP = (() => {
  const m = {};
  for (const [plain, marked] of Object.entries(MARKS)) {
    for (const ch of marked) m[ch] = plain;
  }
  m['ü'] = 'u';
  m['Ü'] = 'U';
  return m;
})();

const VOWELS = 'aoeiuüAOEIUÜ';

function normalizeUmlaut(s) {
  return s.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');
}

/** "ni3" -> "nǐ", "lv4" -> "lǜ", "r5" -> "r". */
export function syllableToMarks(syllable) {
  let s = normalizeUmlaut(String(syllable).trim());
  const m = s.match(/([1-5])$/);
  if (!m) return s;
  const tone = Number(m[1]);
  s = s.slice(0, -1);
  if (tone === 5 || tone === 0) return s;

  let idx = -1;
  for (const v of ['a', 'A', 'o', 'O', 'e', 'E']) {
    idx = s.indexOf(v);
    if (idx !== -1) break;
  }
  if (idx === -1) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (VOWELS.includes(s[i])) { idx = i; break; }
    }
  }
  if (idx === -1) return s;
  const marked = MARKS[s[idx]]?.[tone - 1];
  if (!marked) return s;
  return s.slice(0, idx) + marked + s.slice(idx + 1);
}

/** "ni3 hao3" -> "nǐ hǎo" (spacing kept). */
export function pinyinToMarks(pinyin) {
  return String(pinyin).trim().split(/\s+/).map(syllableToMarks).join(' ');
}

/**
 * Toneless, separator-free search key:
 *   "nǐ hǎo" | "ni3 hao3" | "ni hao" | "Ni Hao" -> "nihao"
 * ü and "v" (typed lü) both collapse to u.
 */
export function tonelessKey(pinyin) {
  let s = String(pinyin).trim().toLowerCase();
  s = s.replace(/[1-5]/g, '');
  s = s.split('').map((c) => STRIP[c] || c).join('');
  s = s.replace(/[^a-zü]/g, '');
  s = s.replace(/ü/g, 'u').replace(/v/g, 'u');
  return s;
}

/** Tone marks from either input form, e.g. "ni3 hao3" -> "nǐ hǎo". */
export function prettyPinyin(pinyin) {
  const p = String(pinyin).trim();
  return /[1-5](\b|$| )/.test(p) || /[1-5]$/.test(p) ? pinyinToMarks(p) : p;
}