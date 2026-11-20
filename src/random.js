/**
 * random.js — the one Fisher-Yates shuffle (unbiased).
 *
 * `sort(() => Math.random() - 0.5)` is biased (the first element stays first
 * ~28% of the time) and is not a real shuffle; every caller now shares this.
 * `rng` is injectable so a seeded generator can make results reproducible.
 */
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
