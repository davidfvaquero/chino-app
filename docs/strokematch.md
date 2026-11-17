# strokematch — drawn-character recognition (no UI)

`src/extras/strokematch.js`. Pure JS, no deps. Matches a drawing against Make Me a Hanzi medians.

## API

```js
import { loadIndex, match } from './extras/strokematch.js';

await loadIndex({ levels: [1] });            // default: chars of HSK 1
await loadIndex({ levels: [1, 2, 3] });      // add more (already-known chars are skipped)
await loadIndex({ chars: '我你他' });         // or explicit chars
await loadIndex({ all: true });              // everything (9574 chars, ~30 MB: desktop/tests)

match(strokes, { max = 10 })
// strokes: [[[x,y],...], ...]  one array per pen stroke, in drawing order, screen coords
//          (y down), any scale/offset (it is normalised).
// -> [{ char, score, distance }]  best first. score = exp(-6*distance) in (0,1], higher = better.
```

Other exports: `addEntries(entries)` (inject `{character, medians}` directly), `clearIndex()`,
`indexSize()`, `DATA_BASE`, and the pure helpers `resample`, `normalize`, `prepare`,
`strokeDistance`, `charDistance`, `assign`. `loadIndex` accepts `base` and `fetchJson(url)` so it runs
under node (tests) or with a custom cache.

## Algorithm

1. Normalise: bounding box of all points -> longest side 1, aspect kept, centred. Medians get the same
   treatment (y flipped: MMAH is y-up).
2. Resample every stroke to 16 points by arc length.
3. Prefilter by stroke count: reference chars with `n-1 .. n+1` strokes.
4. Cheap pass: 4 points/stroke, "nearest stroke on the other side" both ways. Keep the best 60.
5. Full pass on those 60: cost matrix stroke-vs-stroke = mean point distance + 0.25 * mean(start, end
   distance) (point-wise distance already makes direction count), + `0.05 * |i-j| / n` order penalty;
   a missing/extra stroke costs a fixed 0.3. Hungarian assignment, so strokes in a somewhat different
   order still match.

## Measured (node 26, this machine; numbers come from `tests/strokematch.test.mjs`)

Test draws 100 HSK1 chars from their medians (random point density, Gaussian noise of 2% of char
size, scale 0.4-2x, aspect ±10%, random offset), pool = all 9574 chars.

| case | top-1 | top-5 |
| --- | --- | --- |
| noise 2% | 100% | 100% |
| noise 5% + one stroke split in two | 79% | 98% |

Query: 2.8 ms average, 22 ms worst over the full 9574 pool (desktop CPU; budget 150 ms on mobile,
~5-10x slower CPUs still fit). Index build for all 9574 chars: ~250 ms.

## Limits (read before trusting it)

- **Synthetic accuracy is optimistic.** Real finger drawings are wobblier, sloppier in proportion and
  use different stroke breaks than the font. Expect clearly lower numbers; no real-handwriting set was
  available to measure.
- **Stroke order is mostly respected.** Small swaps are fine (order penalty is mild); a wildly
  different order or direction (e.g. drawing a stroke right-to-left) costs a lot.
- **Only ±1 stroke.** A drawing 2+ strokes off the reference is never matched.
- **Same-skeleton characters** (e.g. 未/末, 己/已/巳) differ in stroke length/position by little; they
  often swap within the top-5.
- **Aspect ratio is kept**, so very flat/narrow drawings (一, 丨) are matched by shape and position
  inside their own box; a bare stroke has few distinguishing features (lots of near ties).
- **Dots** (single point strokes) resample to a point; a drawn dot vs a short tick is cheap to confuse.
- Medians are a font skeleton, not handwriting; variant/regional forms follow the Make Me a Hanzi set
  (simplified + traditional chars both present).

## Data loading (important limit)

`public/data/strokes` has **no stroke-count index** and shards are grouped by Unicode order, not by
stroke count or frequency; each shard is ~170 KB because it also ships SVG outlines. So the index
cannot be loaded "per stroke count": `loadIndex` fetches the shards that contain the requested chars
(HSK 1 = 174 chars across 73 shards, ~12 MB; HSK 1-3 ~ 20 MB) and keeps only the medians. The service worker
caches shards after the first fetch. A compact medians-only build (one small file per stroke count)
would make this ~10x lighter; it needs a change in `scripts/build-data.mjs` (not part of this task).
