// scripts/lib/trad-simp.mjs
//
// Traditional -> simplified conversion for the sentence pipeline.
//
// The Tatoeba cmn export mixes traditional and simplified characters. The
// committed shards are simplified, so the pipeline must normalise `zh` the same
// way or a re-run would reintroduce traditional forms (REVIEW.md #16).
//
// A naive "trad !== simp" CC-CEDICT map is wrong on real text: some traditional
// characters also exist as simplified ones (著, 覆, 乾, 么), and some have more
// than one simplified form (參 -> 参/叁). So the map only covers characters that
// are unambiguously traditional (never listed as a simplified form) and, when
// several simplified forms exist, picks the most common one in CC-CEDICT.

/** Build a `traditional char -> simplified char` Map from parsed CC-CEDICT entries. */
export function buildTradSimpMap(dictEntries) {
  const simpChars = new Set();
  for (const e of dictEntries) {
    for (const c of e.simp) simpChars.add(c);
  }
  const counts = new Map(); // traditional char -> Map(simplified char -> entry count)
  for (const e of dictEntries) {
    if (e.trad.length !== 1 || e.simp.length !== 1 || e.trad === e.simp) continue;
    if (simpChars.has(e.trad)) continue; // also a simplified character: leave it alone
    if (!counts.has(e.trad)) counts.set(e.trad, new Map());
    const bySimp = counts.get(e.trad);
    bySimp.set(e.simp, (bySimp.get(e.simp) || 0) + 1);
  }
  const map = new Map();
  for (const [trad, bySimp] of counts) {
    let best = null;
    for (const [simp, n] of bySimp) if (best === null || n > best[1]) best = [simp, n];
    map.set(trad, best[0]);
  }
  return map;
}

/** Replace every traditional-only character in `text` with its simplified form. */
export function toSimplified(text, map) {
  let out = '';
  for (const ch of text) out += map.get(ch) ?? ch;
  return out;
}
