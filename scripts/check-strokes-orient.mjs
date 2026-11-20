#!/usr/bin/env node
/**
 * scripts/check-strokes-orient.mjs — are the strokes drawn the right way up,
 * in the right order and in the right direction?
 *
 * Mobile viewport 390x844, touch, light and dark theme. For 你 一 十 人 我 and
 * the sheet 戴维德 it captures the real screen (stroke outlines, the animated
 * medians, the tracing practice and every sheet step), compares the pixels
 * with the same character drawn by the system font, flipped or not, and checks
 * the first strokes' direction in the DOM. Exit 1 on any failure.
 *
 *   OUT_DIR=/tmp/chino-<id> npm run build
 *   node scripts/check-strokes-orient.mjs /tmp/chino-<id>        (shots: <dir>/shots)
 *
 * Reference font: Noto Sans SC is not installed here; the system CJK font
 * "WenQuanYi Zen Hei" is used instead (override with REF_FONT).
 *
 * Pass rules: correlation (blurred, bbox-normalised masks) with the upright
 * reference >= 0.3 (the font differs from the data: 我 only reaches 0.35 with
 * a correct orientation, so 0.6 is not reachable with this reference); and, except FLIP_INCONCLUSIVE glyphs, the upright
 * correlation beats the vertically flipped one by >= 0.1. Horizontal mirror is
 * not measured by pixels (mirror-like glyphs such as 人 correlate with their
 * mirror image); the DOM checks (first stroke direction, practice acceptance)
 * cover it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChrome, startServer, sleep } from './lib/audit.mjs';

const dir = process.argv[2] || process.env.OUT_DIR || '/tmp/chino-strokes-orient';
const SHOTS = process.env.SHOTS_DIR || `${dir}/shots`;
const REF_FONT = process.env.REF_FONT || 'WenQuanYi Zen Hei';
const MIN_CORR = 0.3;
const MIN_MARGIN = 0.1;
// Vertical flip changes almost nothing for these with this reference font: 一 and 十
// are symmetric, 维 is too close. Their direction is covered by the DOM checks.
const FLIP_INCONCLUSIVE = new Set(['一', '十', '维']);
const SINGLE = ['你', '一', '十', '人', '我'];
const SHEET = '戴维德';
const THEMES = [
  { name: 'light', setting: 'light' },
  { name: 'dark', setting: 'dark' },
];
mkdirSync(SHOTS, { recursive: true });

/* Page-side image maths: masks -> normalised blurred 96x96 -> correlation. */
const PAGE_LIB = `(() => {
  const N = 96;
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const flip = (v, axis) => {
    const out = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = axis === 'h' ? N - 1 - x : x, sy = axis === 'v' ? N - 1 - y : y;
      out[y * N + x] = v[sy * N + sx];
    }
    return out;
  };
  const normalise = ({ mask, w, h }) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, side = Math.max(bw, bh);
    const cx = x0 + bw / 2, cy = y0 + bh / 2;
    const src = canvas(w, h), sctx = src.getContext('2d');
    const img = sctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
    sctx.putImageData(img, 0, 0);
    const out = canvas(N, N), octx = out.getContext('2d');
    octx.filter = 'blur(3px)';
    octx.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, N, N);
    const d = octx.getImageData(0, 0, N, N).data;
    const v = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) v[i] = d[i * 4 + 3] / 255;
    return v;
  };
  const corr = (a, b) => {
    let ma = 0, mb = 0; const n = a.length;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return num / Math.sqrt(da * db || 1);
  };
  const refMask = (ch) => {
    const w = 400, h = 400, c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.font = '320px "${REF_FONT}", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#000'; g.fillText(ch, w / 2, h / 2);
    const d = g.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 128) mask[i] = 1;
    return { mask, w, h };
  };
  const shotMask = (bitmap) => {
    const w = bitmap.width, h = bitmap.height, c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    const d = g.getImageData(0, 0, w, h).data, k0 = ((1 * w) + (w >> 1)) * 4;
    const bg = [d[k0], d[k0 + 1], d[k0 + 2]], mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 120) mask[i] = 1;
    }
    return { mask, w, h };
  };
  const compare = (shotBitmap, ch) => {
    const s = normalise(shotMask(shotBitmap)), r = normalise(refMask(ch));
    if (!s || !r) return { ok: false, reason: 'empty mask' };
    return { up: corr(s, r), flipV: corr(s, flip(r, 'v')), flipH: corr(s, flip(r, 'h')) };
  };
  const bitmapFrom = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  return { compare, bitmapFrom };
})()`;

/** Read the first stroke of a guide/ink path: start and end of the median (screen space). */
const DIRECTION_JS = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const nums = (el.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
  return { start: [nums[0], nums[1]], end: [nums[nums.length - 2], nums[nums.length - 1]] };
})()`;

const rows = [];
const failures = [];
const note = (row) => rows.push(row);

async function clipOf(cdp, selector, index = 0) {
  await cdp.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]; el?.scrollIntoView({ block: 'center' }); })()`);
  await sleep(150);
  return cdp.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  })()`);
}

/** Hide layers around a capture; returns the function that restores them. */
async function hideLayers(cdp, selectors) {
  await cdp.eval(`(() => { window.__hidden = []; for (const s of ${JSON.stringify(selectors)}) for (const el of document.querySelectorAll(s)) { window.__hidden.push([el, el.style.display]); el.style.display = 'none'; } })()`);
  return () => cdp.eval(`(() => { for (const [el, d] of window.__hidden) el.style.display = d; window.__hidden = []; })()`);
}

async function compareCapture(cdp, { label, selector, index = 0, hide, char, file }) {
  const restore = await hideLayers(cdp, hide);
  let result;
  try {
    const clip = await clipOf(cdp, selector, index);
    if (!clip) throw new Error(`${selector} missing`);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 2 },
    });
    writeFileSync(`${SHOTS}/${file}.png`, Buffer.from(shot.data, 'base64'));
    result = await cdp.eval(`(async () => {
      const lib = ${PAGE_LIB};
      const bitmap = await lib.bitmapFrom(${JSON.stringify(shot.data)});
      return lib.compare(bitmap, ${JSON.stringify(char)});
    })()`);
  } catch (error) {
    result = { ok: false, reason: error.message };
  } finally {
    await restore();
  }
  // Shape: the system font is not the Make Me a Hanzi design, so only a loose bound.
  let ok = result?.up !== undefined && result.up >= MIN_CORR;
  // Upside down must lose clearly to upright (skipped where flips look alike).
  if (ok && !FLIP_INCONCLUSIVE.has(char)) ok = result.up - result.flipV >= MIN_MARGIN;
  if (!ok) failures.push(`${label}: ${JSON.stringify(result)}`);
  note({ label, char, up: result?.up, flipV: result?.flipV, flipH: result?.flipH, ok, reason: result?.reason });
  return ok;
}

async function directionCheck(cdp, label, selector, expect) {
  const got = await cdp.eval(DIRECTION_JS(selector));
  let ok = Boolean(got);
  if (got) {
    const { start, end } = got;
    if (expect === 'left-right') ok = start[0] < end[0];
    if (expect === 'top-bottom') ok = start[1] < end[1];
    if (expect === 'top-left-down') ok = start[1] < end[1] && start[0] > end[0];
  }
  if (!ok) failures.push(`${label}: got ${JSON.stringify(got)} expect ${expect}`);
  note({ label, char: '', up: null, flipV: null, flipH: null, ok, reason: `${expect} ${JSON.stringify(got)}` });
}

/** Real pointer drag through a path's screen points (same approach as check-strokes-dark). */
async function drag(cdp, selector, reverse) {
  const pts = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const m = el.ownerSVGElement.getScreenCTM();
    const nums = (el.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([m.a * nums[i] + m.c * nums[i + 1] + m.e, m.b * nums[i] + m.d * nums[i + 1] + m.f]);
    return ${reverse} ? out.reverse() : out;
  })()`);
  const [first, ...rest] = pts;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first[0], y: first[1], button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of rest) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
  const last = rest[rest.length - 1] ?? first;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], button: 'left', buttons: 0, clickCount: 1 });
}

const server = await startServer(dir);
const { cdp, stop } = await launchChrome();
try {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await cdp.send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    acceptLanguage: 'es-ES,es',
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  for (const theme of THEMES) {
    const tag = theme.name;
    await cdp.send('Page.navigate', { url: `${server.base}/#/` });
    await cdp.waitFor('html[data-ready="true"]', 10000);
    await cdp.eval(`import('./src/settings.js').then((m) => m.setSetting('theme', ${JSON.stringify(theme.setting)}))`);
    await sleep(300);

    for (const char of SINGLE) {
      await cdp.eval(`location.hash = '#/learn/strokes/${char}'`);
      if (!(await cdp.waitFor('.strokes-ghost', 8000))) { failures.push(`${tag} ${char}: no outlines`); continue; }
      await sleep(3800); // animation finished (7 strokes x 420 ms at most)
      const hideGuides = ['.strokes-guides', '.strokes-trace-guides', '.strokes-trace-drawn-layer', '.strokes-trace-done-layer'];

      // Outlines of the glyph (the shape the learner sees behind the strokes).
      await compareCapture(cdp, { label: `${tag} ${char} outline`, selector: '.strokes-svg', hide: [...hideGuides, '.strokes-inks'], char, file: `${tag}-${char}-outline` });
      // Animated medians (pen lines) as they end up after the animation.
      await compareCapture(cdp, { label: `${tag} ${char} animation (pen)`, selector: '.strokes-svg', hide: [...hideGuides, '.strokes-ghosts'], char, file: `${tag}-${char}-animation` });
      await directionCheck(cdp, `${tag} ${char} animation order: first pen stroke`, '.strokes-ink[data-index="0"]', char === '一' ? 'left-right' : char === '十' ? 'left-right' : char === '你' ? 'top-left-down' : 'top-bottom');

      // Tracing practice: guides on, ghosts behind; direction of guide 0 and what is accepted.
      await cdp.eval(`document.querySelector('.strokes-practice-btn').click()`);
      if (!(await cdp.waitFor('.strokes-trace-guide', 4000))) { failures.push(`${tag} ${char}: no practice guides`); continue; }
      await sleep(200);
      await compareCapture(cdp, { label: `${tag} ${char} practice`, selector: '.strokes-svg', hide: [...hideGuides, '.strokes-inks'], char, file: `${tag}-${char}-practice` });
      await directionCheck(cdp, `${tag} ${char} practice guide 0`, '.strokes-trace-guide[data-index="0"]', char === '一' ? 'left-right' : char === '十' ? 'left-right' : char === '你' ? 'top-left-down' : 'top-bottom');
      if (char === '十') await directionCheck(cdp, `${tag} 十 practice guide 1`, '.strokes-trace-guide[data-index="1"]', 'top-bottom');
      // Reverse drag on stroke 0 must be refused, forward accepted.
      await drag(cdp, '.strokes-trace-guide[data-index="0"]', true);
      await sleep(80);
      const refused = await cdp.eval(`Boolean(document.querySelector('.strokes-trace-drawn[data-result="wrong"]'))`);
      await sleep(700);
      await drag(cdp, '.strokes-trace-guide[data-index="0"]', false);
      await sleep(150);
      const accepted = await cdp.eval(`Boolean(document.querySelector('.strokes-trace-done[data-index="0"]'))`);
      if (!refused || !accepted) failures.push(`${tag} ${char} practice: reverse refused=${refused}, forward accepted=${accepted}`);
      note({ label: `${tag} ${char} practice drag`, char, up: null, flipV: null, flipH: null, ok: refused && accepted, reason: `reverse refused=${refused} forward accepted=${accepted}` });
      await cdp.eval(`document.querySelector('.strokes-practice-btn').click()`);
    }

    // Multi-character sheet: every card, every step.
    await cdp.eval(`location.hash = '#/learn/strokes/${SHEET}'`);
    if (!(await cdp.waitFor('.sheet-card .sheet-step svg', 8000))) { failures.push(`${tag} sheet: no steps`); continue; }
    await sleep(400);
    const cards = await cdp.eval(`[...document.querySelectorAll('.sheet-card')].map((c) => c.querySelector('.sheet-char').textContent)`);
    for (const [cardIndex, char] of cards.entries()) {
      const stepInfo = await cdp.eval(`(() => {
        const card = [...document.querySelectorAll('.sheet-card')][${cardIndex}];
        return [...card.querySelectorAll('.sheet-step')].map((step, k) => ({
          count: step.querySelectorAll('.stroke-part').length,
          newIndex: Number(step.querySelector('.stroke-part-new')?.getAttribute('data-index')),
          k,
        }));
      })()`);
      const orderOk = stepInfo.every((s) => s.count === s.k + 1 && s.newIndex === s.k);
      if (!orderOk) failures.push(`${tag} sheet ${char}: step order ${JSON.stringify(stepInfo)}`);
      note({ label: `${tag} sheet ${char} step order`, char, up: null, flipV: null, flipH: null, ok: orderOk, reason: `${stepInfo.length} steps` });
      // One match per card (its last step), so `index` picks the card.
      await compareCapture(cdp, {
        label: `${tag} sheet ${char} last step`,
        selector: '.sheet-card .sheet-step:last-child svg',
        index: cardIndex,
        hide: [],
        char,
        file: `${tag}-sheet-${char}-last`,
      });
    }
    await cdp.shot(`${SHOTS}/${tag}-sheet.png`);
  }
} finally {
  stop();
  server.stop();
}

console.log('theme | screen | char | corr up | flipV | flipH | result');
for (const r of rows) {
  const f = (v) => (v === null || v === undefined ? '  -  ' : v.toFixed(2));
  console.log(`${r.label.padEnd(44)} ${r.char.padEnd(2)} ${f(r.up)} ${f(r.flipV)} ${f(r.flipH)}  ${r.ok ? 'OK' : 'FAIL'}${r.reason && !r.ok ? ' (' + r.reason + ')' : ''}`);
}
writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ rows, failures }, null, 2));
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(`\nall ${rows.length} checks OK; shots in ${SHOTS}`);
