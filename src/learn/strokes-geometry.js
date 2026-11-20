/**
 * strokes-geometry.js — pure geometry of the stroke-order module
 * (docs/REVIEW-2.md I14 split `src/learn/strokes.js` into focused files).
 *
 * Browser-free and side-effect free: the median/polyline maths behind the
 * animation pen line and the tracing tolerance check. No DOM, no I/O.
 */
/** Practice tolerance in viewBox units (~12% of the box) — deliberately loose. */
export const DEFAULT_TOLERANCE = 120;
/** Fraction of the median the drawing must cover to count as the right stroke. */
export const MIN_COVERAGE = 0.6;
const CHILD_TOLERANCE = 1.5; // start/end may be sloppier than the middle
const SAMPLE_COUNT = 24;
const MIN_DRAWN_POINTS = 2;

export const clamp01 = (value) => Math.max(0, Math.min(1, value));
export const isPoint = (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const round1 = (value) => Math.round(value * 10) / 10;
const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Polyline through the stroke median, as an SVG path (the animated pen line). */
export function medianToPath(median) {
  const points = (Array.isArray(median) ? median : []).filter(isPoint);
  if (!points.length) return '';
  const [first, ...rest] = points;
  return `M ${round1(first[0])} ${round1(first[1])}${rest
    .map((point) => ` L ${round1(point[0])} ${round1(point[1])}`)
    .join('')}`;
}

/** Length of the median polyline (also the animation fallback when the DOM cannot measure). */
export function pathLengthFromMedian(median) {
  const points = (Array.isArray(median) ? median : []).filter(isPoint);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  return total;
}

export function pointToSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = clamp01(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared);
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

/** Shortest distance from a point to a polyline (Infinity for an empty one). */
export function distanceToPolyline(point, polyline) {
  const points = (Array.isArray(polyline) ? polyline : []).filter(isPoint);
  if (!isPoint(point) || !points.length) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, pointToSegmentDistance(point, points[index - 1], points[index]));
  }
  return best;
}

/** `count` points spread evenly along the polyline by arc length. */
export function resamplePolyline(polyline, count = SAMPLE_COUNT) {
  const points = (Array.isArray(polyline) ? polyline : []).filter(isPoint);
  if (!points.length) return [];
  if (points.length === 1 || count < 2) return [[points[0][0], points[0][1]]];
  const total = pathLengthFromMedian(points);
  if (total === 0) return Array.from({ length: count }, () => [points[0][0], points[0][1]]);

  const step = total / (count - 1);
  const out = [[points[0][0], points[0][1]]];
  let segment = 1;
  let walked = 0;
  let target = 1;
  while (target < count && segment < points.length) {
    const from = points[segment - 1];
    const to = points[segment];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) {
      segment += 1;
      continue;
    }
    if (walked + length >= target * step) {
      const ratio = (target * step - walked) / length;
      out.push([from[0] + ratio * (to[0] - from[0]), from[1] + ratio * (to[1] - from[1])]);
      target += 1;
    } else {
      walked += length;
      segment += 1;
    }
  }
  while (out.length < count) out.push([points[points.length - 1][0], points[points.length - 1][1]]);
  return out;
}

/**
 * Tolerant check that a drawn polyline is the given stroke: the median must be
 * covered by the drawing, which has to start near the median's start and end
 * near its end (a stroke drawn backwards does not count — order matters here).
 */
export function matchStroke(drawn, median, { tolerance = DEFAULT_TOLERANCE, minCoverage = MIN_COVERAGE } = {}) {
  const drawnPoints = (Array.isArray(drawn) ? drawn : []).filter(isPoint);
  const medianPoints = (Array.isArray(median) ? median : []).filter(isPoint);
  const empty = { ok: false, score: 0, coverage: 0, startDistance: Infinity, endDistance: Infinity };
  if (medianPoints.length < 1 || drawnPoints.length < MIN_DRAWN_POINTS) return empty;

  const samples = resamplePolyline(medianPoints, SAMPLE_COUNT);
  const covered = samples.filter((sample) => distanceToPolyline(sample, drawnPoints) <= tolerance).length;
  const coverage = covered / samples.length;
  const first = drawnPoints[0];
  const last = drawnPoints[drawnPoints.length - 1];
  const medianStart = medianPoints[0];
  const medianEnd = medianPoints[medianPoints.length - 1];
  const startDistance = distanceToPolyline(first, medianPoints);
  const endDistance = distanceToPolyline(last, medianPoints);
  const reach = tolerance * CHILD_TOLERANCE;
  // Direction: the drawing must begin nearer the median's start than its end
  // (and vice versa) — a reversed stroke fails, sloppy but ordered ones pass.
  const ordered =
    pointDistance(first, medianStart) <= pointDistance(first, medianEnd) &&
    pointDistance(last, medianEnd) <= pointDistance(last, medianStart);
  const ok = coverage >= minCoverage && startDistance <= reach && endDistance <= reach && ordered;

  return { ok, score: Math.round(coverage * 100) / 100, coverage, startDistance, endDistance, ordered };
}

export { SAMPLE_COUNT };
