// Pinyin utilities (no external deps).
//
// CC-CEDICT and the HSK lists ship pinyin with *tone numbers* (e.g. "ni3 hao3",
// "nu:3", "lv4"). This module converts that to pinyin with *tone marks*
// ("nǐ hǎo") and also produces a "toneless" key used for indexing/search.
//
// Reference for the tone-placement rule: the mark goes on the vowel that is
// pronounced first among  a > o > e , otherwise on the last vowel of the
// syllable (which covers iu -> u and ui -> i).
//
// The module is intentionally dependency-free so the whole data pipeline
// runs with a plain `node scripts/build-data.mjs` and no `npm install`.

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

// Reverse map used to strip tone marks back to plain letters.
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

/** Replace "u:" / "v" / "U:" with the ü letter, keeping case. */
function normalizeUmlaut(s) {
  return s
    .replace(/u:/g, 'ü')
    .replace(/U:/g, 'Ü')
    .replace(/v/g, 'ü')
    .replace(/V/g, 'Ü');
}

/**
 * Convert a single numbered syllable to a tone-marked syllable.
 * "ni3" -> "nǐ", "lv4" -> "lǜ", "r5" -> "r", "Bei3" -> "Běi".
 */
export function syllableToMarks(syllable) {
  let s = normalizeUmlaut(String(syllable).trim());
  const m = s.match(/([1-5])$/);
  if (!m) return s; // no tone info: leave as-is (neutral-ish)
  const tone = Number(m[1]);
  s = s.slice(0, -1);
  if (tone === 5 || tone === 0) return s;

  // Choose the vowel that carries the mark.
  let idx = -1;
  for (const v of ['a', 'A', 'o', 'O', 'e', 'E']) {
    idx = s.indexOf(v);
    if (idx !== -1) break;
  }
  if (idx === -1) {
    // last vowel in the syllable
    for (let i = s.length - 1; i >= 0; i--) {
      if (VOWELS.includes(s[i])) { idx = i; break; }
    }
  }
  if (idx === -1) return s; // no vowel (e.g. "r", "m", "ng")

  const letter = s[idx];
  const marked = MARKS[letter]?.[tone - 1];
  if (!marked) return s;
  return s.slice(0, idx) + marked + s.slice(idx + 1);
}

/**
 * Convert a full numbered pinyin string (space separated syllables) to marks.
 * "ni3 hao3" -> "nǐ hǎo". Keeps the original word boundaries/spacing.
 */
export function pinyinToMarks(pinyin) {
  return String(pinyin)
    .trim()
    .split(/\s+/)
    .map(syllableToMarks)
    .join(' ');
}

/**
 * Toneless, separator-free key used for pinyin search:
 *   "nǐ hǎo" / "ni3 hao3" / "Ni Hao" -> "nihao"
 * ü collapses to u (so "lǜ" and "lv4" both -> "lu"/"lv" match via lv->lu),
 * and an optional "u:" form is accepted.
 */
export function tonelessKey(pinyin) {
  let s = String(pinyin).trim().toLowerCase();
  s = s.replace(/[1-5]/g, '');          // drop tone numbers
  s = s.split('').map((c) => STRIP[c] || c).join(''); // drop tone marks
  s = s.replace(/[^a-zü]/g, '');        // keep letters (incl. ü)
  s = s.replace(/ü/g, 'u');             // ü -> u
  s = s.replace(/v/g, 'u');             // "lv" (typed form of lü) -> "lu"
  return s;
}

/** Tone-marked string with spaces, e.g. "nǐ hǎo" (from either input form). */
export function prettyPinyin(pinyin) {
  const p = String(pinyin).trim();
  return /[1-5]\b/.test(p) || /[1-5]$/.test(p) || /[1-5] /.test(p)
    ? pinyinToMarks(p)
    : p;
}
