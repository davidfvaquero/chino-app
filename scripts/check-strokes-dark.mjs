#!/usr/bin/env node
/**
 * scripts/check-strokes-dark.mjs — stroke visibility guard, light and dark.
 *
 * Opens the stroke screens at 390x844 touch — the stroke animation and tracing
 * practice of #/learn/strokes/你, the multi-character sheet
 * (#/learn/strokes/戴维德), the printable worksheet (#/extras/worksheet) and the
 * draw canvas (#/extras/draw) — drives them with real pointer input, and
 * measures the colour actually painted for every stroke and guide against the
 * surface under it. Four combinations of user theme (settings) and OS scheme
 * are checked. Exit 1 when any ratio is below 3:1 (WCAG non-text contrast).
 *
 *   OUT_DIR=/tmp/chino-<id> npm run build
 *   node scripts/check-strokes-dark.mjs /tmp/chino-<id>
 *   SHOTS_DIR=/tmp/chino-<id>/shots node scripts/check-strokes-dark.mjs <dir>
 */
import { mkdirSync } from 'node:fs';
import { launchChrome, startServer, sleep } from './lib/audit.mjs';

const dir = process.argv[2] || process.env.OUT_DIR || '/tmp/chino-strokes-dark';
const SHOTS_DIR = process.env.SHOTS_DIR || '';
const MIN_RATIO = 3;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });

const COMBOS = [
  { name: 'settings-dark / os-light', setting: 'dark', os: 'light' },
  { name: 'settings-auto / os-dark', setting: 'auto', os: 'dark' },
  { name: 'settings-light / os-dark', setting: 'light', os: 'dark' },
  { name: 'settings-light / os-light', setting: 'light', os: 'light' },
];

/** Injected once per page: colour maths + measurement of painted pixels. */
const PAGE_LIB = `(() => {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const g = probe.getContext('2d', { willReadFrequently: true });
  const norm = (css) => {
    g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1);
    return [...g.getImageData(0, 0, 1, 1).data];
  };
  const lum = ([r, gg, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  const opaqueBg = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = norm(getComputedStyle(n).backgroundColor);
      if (c[3] >= 250) return c.slice(0, 3);
    }
    return [255, 255, 255];
  };
  const svgRatio = (el) => {
    const cs = getComputedStyle(el);
    const prop = cs.fill !== 'none' ? 'fill' : 'stroke';
    if (cs[prop] === 'none') return { ratio: 1, note: 'not painted' };
    const c = norm(cs[prop]);
    let op = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      op *= parseFloat(getComputedStyle(n).opacity) || 1;
      if (n.tagName.toLowerCase() === 'svg') break;
    }
    const bg = opaqueBg(el.closest('svg'));
    const fg = mix(c.slice(0, 3), (c[3] / 255) * op, bg);
    return { ratio: ratio(fg, bg), note: prop + ' ' + cs[prop] + ' op ' + op.toFixed(2) };
  };
  const canvasRatio = (cv) => {
    const cs = getComputedStyle(cv);
    const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue;
      const k = data[i] + ',' + data[i + 1] + ',' + data[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (!counts.size) return { ratio: 1, note: 'nothing painted' };
    const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const bg = opaqueBg(cv);
    const fg = mix(key.split(',').map(Number), parseFloat(cs.opacity) || 1, bg);
    return { ratio: ratio(fg, bg), note: 'pixels ' + key + ' op ' + cs.opacity };
  };
  const guidePts = (path) => {
    const m = path.ownerSVGElement.getScreenCTM();
    const nums = (path.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      out.push([m.a * nums[i] + m.c * nums[i + 1] + m.e, m.b * nums[i] + m.d * nums[i + 1] + m.f]);
    }
    return out;
  };
  const rectPts = (el, fractions) => {
    const r = el.getBoundingClientRect();
    return fractions.map(([x, y]) => [r.left + r.width * x, r.top + r.height * y]);
  };
  return { svgRatio, canvasRatio, guidePts, rectPts };
})()`;

/** Every painted element of `selector` (min ratio wins), or null when none. */
async function measureAll(cdp, selector) {
  return cdp.eval(`(() => {
    const list = [...document.querySelectorAll(${JSON.stringify(selector)})];
    if (!list.length) return null;
    const rows = list.map((el) => window.__cc.svgRatio(el));
    rows.sort((a, b) => a.ratio - b.ratio);
    return { count: list.length, ...rows[0] };
  })()`);
}

async function measureCanvas(cdp, selector) {
  return cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? window.__cc.canvasRatio(el) : null;
  })()`);
}

async function drag(cdp, points) {
  if (!points.length) return;
  const [first, ...rest] = points;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first[0], y: first[1], button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of rest) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
  }
}

async function release(cdp, point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point[0], y: point[1], button: 'left', buttons: 0, clickCount: 1 });
}

const rows = [];
const record = (combo, screen, item, result) => {
  rows.push({ combo, screen, item, ratio: result ? result.ratio : null, count: result?.count, note: result?.note ?? 'missing' });
};

const server = await startServer(dir);
const { cdp, stop } = await launchChrome();
const failures = [];
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

  for (const combo of COMBOS) {
    const label = combo.name;
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: combo.os }] });
    await cdp.send('Page.navigate', { url: `${server.base}/#/` });
    await cdp.waitFor('html[data-ready="true"]', 10000);
    await cdp.eval(`import('./src/settings.js').then((m) => m.setSetting('theme', ${JSON.stringify(combo.setting)}))`);
    await cdp.eval(`window.__cc = ${PAGE_LIB}`);
    await sleep(300);
    const shot = async (screen) => {
      if (SHOTS_DIR) await cdp.shot(`${SHOTS_DIR}/${combo.setting}-${combo.os}-${screen}.png`);
    };
    const step = async (screen, fn) => {
      try {
        await fn();
      } catch (error) {
        failures.push(`${label} ${screen}: ${error.message}`);
      }
    };

    /* Stroke animation of a single character (done state) */
    await step('animation', async () => {
      await cdp.eval("location.hash = '#/learn/strokes/你'");
      if (!(await cdp.waitFor('.strokes-ink', 8000))) throw new Error('.strokes-ink never rendered');
      await sleep(3800); // 7 strokes x 420 ms
      record(label, 'animation', 'stroke (ink)', await measureAll(cdp, '.strokes-ink'));
      record(label, 'animation', 'ghost outline', await measureAll(cdp, '.strokes-ghost'));
      record(label, 'animation', 'grid guide', await measureAll(cdp, '.strokes-guide'));
      await shot('animation');
    });

    /* Tracing practice: guide, stroke in progress, wrong flash, done */
    await step('practice', async () => {
      await cdp.eval("location.hash = '#/learn/strokes/你'");
      if (!(await cdp.waitFor('.strokes-ink', 8000))) throw new Error('.strokes-ink never rendered');
      await sleep(300);
      await cdp.eval("document.querySelector('.strokes-practice-btn').click()");
      if (!(await cdp.waitFor('.strokes-trace-guide', 4000))) throw new Error('trace guides never rendered');
      await sleep(200);
      record(label, 'practice', 'trace guide', await measureAll(cdp, '.strokes-trace-guide'));
      const pts = await cdp.eval("window.__cc.guidePts(document.querySelector('.strokes-trace-guide[data-current=\"true\"]'))");
      await drag(cdp, pts.slice(0, -1));
      await sleep(60);
      record(label, 'practice', 'stroke in progress', await measureAll(cdp, '.strokes-trace-drawn'));
      await release(cdp, pts[pts.length - 1]);
      await sleep(120);
      record(label, 'practice', 'stroke done', await measureAll(cdp, '.strokes-trace-done'));
      const next = await cdp.eval("window.__cc.guidePts(document.querySelector('.strokes-trace-guide[data-current=\"true\"]'))");
      await drag(cdp, next.slice().reverse().slice(0, -1));
      await release(cdp, next[0]);
      await sleep(60);
      record(label, 'practice', 'wrong stroke', await measureAll(cdp, '.strokes-trace-drawn[data-result="wrong"]'));
      await shot('practice');
    });

    /* Multi-character sheet */
    await step('sheet', async () => {
      await cdp.eval("location.hash = '#/learn/strokes/戴维德'");
      if (!(await cdp.waitFor('.sheet-step', 8000))) throw new Error('.sheet-step never rendered');
      await sleep(400);
      record(label, 'sheet', 'step strokes', await measureAll(cdp, '.sheet-step .stroke-part:not(.stroke-part-new)'));
      record(label, 'sheet', 'step new stroke', await measureAll(cdp, '.sheet-step .stroke-part-new'));
      await shot('sheet');
    });

    /* Printable worksheet: the stroke diagram on the character header */
    await step('worksheet', async () => {
      await cdp.eval("location.hash = '#/extras/worksheet'");
      if (!(await cdp.waitFor('.ws-input', 8000))) throw new Error('.ws-input never rendered');
      // Force the DOM (non-canvas) sheet so the stroke SVG is measurable, then
      // generate a sheet for 你.
      await cdp.eval(`(() => {
        const style = document.querySelector('.ws-select[data-option="style"]');
        if (style) { style.value = 'cards'; style.dispatchEvent(new Event('change', { bubbles: true })); }
        const input = document.querySelector('.ws-input');
        input.value = '你';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.ws-actions .ws-btn.primary:not([data-action])').click();
      })()`);
      if (!(await cdp.waitFor('.ws-char-head .stroke-part', 8000))) throw new Error('worksheet stroke diagram never rendered');
      await sleep(200);
      record(label, 'worksheet', 'stroke diagram', await measureAll(cdp, '.ws-char-head .stroke-part'));
      await shot('worksheet');
    });

    /* Hand-drawing canvas */
    await step('draw', async () => {
      await cdp.eval("location.hash = '#/extras/draw'");
      if (!(await cdp.waitFor('canvas.draw-canvas', 8000))) throw new Error('draw canvas never rendered');
      await sleep(400);
      const zigzag = await cdp.eval("window.__cc.rectPts(document.querySelector('canvas.draw-canvas'), [[0.2,0.25],[0.8,0.3],[0.25,0.6],[0.75,0.7],[0.3,0.9]])");
      await drag(cdp, zigzag.slice(0, -1));
      await sleep(60);
      record(label, 'draw', 'stroke in progress', await measureCanvas(cdp, 'canvas.draw-canvas'));
      await release(cdp, zigzag[zigzag.length - 1]);
      await sleep(120);
      record(label, 'draw', 'stroke done', await measureCanvas(cdp, 'canvas.draw-canvas'));
      record(label, 'draw', 'grid guide', await measureCanvas(cdp, 'canvas.draw-grid'));
      await shot('draw');
      const other = combo.setting === 'dark' ? 'light' : 'dark';
      await cdp.eval(`import('./src/settings.js').then((m) => m.setSetting('theme', ${JSON.stringify(other)}))`);
      await sleep(250);
      record(label, 'draw', 'after theme switch', await measureCanvas(cdp, 'canvas.draw-canvas'));
    });
  }
} finally {
  stop();
  server.stop();
}

/* ---- report ---- */
const fmt = (value) => (value === null || value === undefined ? '   -  ' : value.toFixed(2).padStart(6));
let failed = 0;
console.log('theme / OS                  screen      item                ratio');
for (const row of rows) {
  const ok = row.ratio !== null && row.ratio >= MIN_RATIO;
  if (!ok) failed += 1;
  console.log(
    `${row.combo.padEnd(27)} ${row.screen.padEnd(11)} ${row.item.padEnd(19)} ${fmt(row.ratio)} ${ok ? 'OK ' : 'LOW'} ${row.note}`,
  );
}
for (const message of failures) console.log(`ERROR ${message}`);
console.log(`\n${rows.length} measurements, ${failed} below ${MIN_RATIO}:1, ${failures.length} screen errors`);
process.exit(failed || failures.length ? 1 : 0);
