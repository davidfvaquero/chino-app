#!/usr/bin/env node
/**
 * scripts/check-contrast.mjs — design guard for the main flows (no dependencies).
 *
 * For every view of the main flows (Home, Dictionary, Review, Lesson with each
 * exercise type + result, Read, Learn/More hubs) at 390 and 320 px, light and
 * dark, in en and es, it asserts from the real DOM that:
 *   - every visible text has WCAG AA contrast (4.5:1; 3:1 for large text);
 *   - form fields, .btn (not .ghost) and .chip have a 3:1 boundary or fill;
 *   - every button / link / field is >= 44x44 CSS px (.word tokens in running
 *     text are exempt);
 *   - there is no horizontal overflow.
 * Plus: the five tone colours vs bg / surface / inset in both themes, and the
 * settings toggles (theme, font scale, tone colours) really change the page.
 *
 * Usage:
 *   OUT_DIR=/tmp/chino-<id> npm run build
 *   node scripts/check-contrast.mjs /tmp/chino-<id>
 *   SHOTS_DIR=/tmp/chino-<id>/shots node scripts/check-contrast.mjs <dir>   # also save screenshots
 *   ONLY=home,review node scripts/check-contrast.mjs <dir>                  # subset of flows
 * Exit code 0 = everything passed.
 */
import { mkdirSync } from 'node:fs';
import { runScenarios, AUDIT_FN } from './lib/audit.mjs';

const dir = process.argv[2] || process.env.OUT_DIR || '/tmp/chino-design';
const SHOTS_DIR = process.env.SHOTS_DIR || '';
const only = process.env.ONLY ? process.env.ONLY.split(',') : undefined;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });

/** In the page: tone colours on each surface. */
const TONE_FN = `(function(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (css) => { g.clearRect(0,0,1,1); g.fillStyle = css; g.fillRect(0,0,1,1); return [...g.getImageData(0,0,1,1).data]; };
  const lum = (c) => { const f = [0,1,2].map(i => { const v = c[i]/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  const host = document.createElement('div'); document.body.append(host);
  const res = [];
  for (const surface of ['--bg', '--surface', '--inset']) {
    host.style.background = 'var(' + surface + ')';
    const bg = rgb(getComputedStyle(host).backgroundColor);
    for (let n = 1; n <= 5; n++) {
      const s = document.createElement('span'); s.className = 'tone tone' + n; s.textContent = 'nǐ'; host.append(s);
      res.push({ tone: n, surface, ratio: Math.round(ratio(rgb(getComputedStyle(s).color), bg) * 100) / 100 });
      s.remove();
    }
  }
  host.remove();
  return res;
})()`;

const SETTINGS_FN = `(async()=>{
  const m = await import('./src/settings.js');
  const bgOf = () => getComputedStyle(document.body).backgroundColor;
  const out = {};
  await m.setSetting('theme', 'light'); out.light = bgOf();
  await m.setSetting('theme', 'dark'); out.dark = bgOf();
  await m.setSetting('theme', 'auto');
  await m.setSetting('fontScale', 1.3); out.rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  await m.setSetting('fontScale', 1);
  out.rem1 = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return out;
})()`;

/** In the page: own font loaded, nothing fetched from another origin. */
const FONT_FN = `(async()=>{
  await document.fonts.ready;
  const external = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => new URL(u).origin !== location.origin);
  return { onest: document.fonts.check('600 16px Onest'), external };
})()`;
const MOTION_FN = `(()=>{ const el = document.querySelector('.hz-cell.lg') || document.querySelector('.screen > *'); return getComputedStyle(el).animationDuration; })()`;

const results = new Map();
let total = 0;
const bad = [];
const failures = await runScenarios(dir, {
  only,
  widths: process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : undefined,
  themes: process.env.THEMES ? process.env.THEMES.split(',') : undefined,
  locales: process.env.LOCALES ? process.env.LOCALES.split(',') : undefined,
  onView: async ({ name, width, theme, locale, cdp }) => {
    const out = await cdp.eval(AUDIT_FN);
    const key = `${name} ${locale} ${width} ${theme}`;
    total++;
    const issues = [
      ...(out.overflow > 1 ? [`overflow ${out.overflow}px`] : []),
      ...out.contrast.map((c) => `contrast ${c.ratio}<${c.need} ${c.el}`),
      ...out.boundary.map((c) => `boundary ${c.ratio}<3 ${c.el}`),
      ...out.targets.map((c) => `target ${c.w}x${c.h} ${c.el}`),
    ];
    if (SHOTS_DIR) await cdp.shot(`${SHOTS_DIR}/${locale}-${width}-${theme}-${name}.png`);
    results.set(key, { texts: out.texts, controls: out.controls, issues });
    if (issues.length) bad.push(`${key}\n      ${[...new Set(issues)].slice(0, 8).join('\n      ')}`);
    console.log(`  ${issues.length ? 'FAIL' : 'OK  '} ${key.padEnd(46)} ${out.texts} texts, ${out.controls} controls${issues.length ? `, ${issues.length} issue(s)` : ''}`);
  },
});

// Tones + settings: one extra pass with a fresh browser context.
const extra = [];
await runScenarios(dir, {
  only: ['home'],
  widths: [390],
  locales: ['en'],
  onView: async ({ theme, cdp }) => {
    for (const r of await cdp.eval(TONE_FN)) if (r.ratio < 4.5) extra.push(`tone${r.tone} on ${r.surface} (${theme}): ${r.ratio} < 4.5`);
    if (theme === 'light') {
      const font = await cdp.eval(FONT_FN);
      if (!font.onest) extra.push('self-hosted font Onest did not load');
      if (font.external.length) extra.push(`requests to other origins: ${font.external.slice(0, 3).join(', ')}`);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      const dur = await cdp.eval(MOTION_FN);
      if (parseFloat(dur) > 0.01) extra.push(`prefers-reduced-motion still animates (${dur})`);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      const motionOn = await cdp.eval(MOTION_FN);
      if (!(parseFloat(motionOn) > 0.1)) extra.push(`entry animation missing without reduced-motion (${motionOn})`);
      const s = await cdp.eval(SETTINGS_FN);
      if (s.light === s.dark) extra.push(`theme toggle: light and dark give the same background (${s.light})`);
      if (!(s.rem > s.rem1 * 1.25)) extra.push(`font scale 1.3 did not grow the root size (${s.rem} vs ${s.rem1})`);
    }
  },
});

console.log('');
for (const b of bad) console.log(`FAIL ${b}`);
for (const e of extra) console.log(`FAIL ${e}`);
for (const f of failures) console.log(`FAIL scenario ${f}`);
const nBad = bad.length + extra.length + failures.length;
console.log(`\ncheck-contrast: ${total - bad.length}/${total} views OK, tones+settings ${extra.length ? 'FAILED' : 'OK'}, ${failures.length} scenario error(s)`);
process.exit(nBad ? 1 : 0);
