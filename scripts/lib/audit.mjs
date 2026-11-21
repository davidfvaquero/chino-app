/**
 * scripts/lib/audit.mjs — headless-Chrome harness shared by check-contrast.mjs.
 * No npm dependencies: static server (serve.mjs) + Chrome DevTools Protocol.
 *
 * runScenarios(dir, { widths, themes, locales, onView }) walks the main flows
 * (Home, Dictionary, Review, Lesson with every exercise type, Read, hubs) and
 * calls onView({ name, width, theme, locale, cdp }) once the view is on screen.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));
const CHROME = [
  process.env.CHROME_BIN,
  '/home/homelab/.hermes/tools/chromium-1208/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => existsSync(p));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every area beyond the main flows, by route: [audit label, hash]. Reachable
 * directly (`#/learn/<area>`) even before the hub menu lists it; only the
 * integration task (HOME) adds the menu cards, not the route.
 */
export const AREAS = [
  ['area-tones', '#/learn/tones'],
  ['area-pinyin-chart', '#/learn/pinyin-chart'],
  ['area-strokes', '#/learn/strokes'],
  ['area-strokes-sheet', '#/learn/strokes/妈妈'],
  ['area-sentences', '#/learn/sentences'],
  ['area-themes', '#/learn/themes'],
  ['area-dictation', '#/learn/dictation'],
  ['area-games', '#/learn/games'],
  ['area-games-matching', '#/learn/games/matching'],
  ['area-games-memory', '#/learn/games/memory'],
  ['area-games-timed', '#/learn/games/timed'],
  ['area-games-builder', '#/learn/games/builder'],
  ['area-radicals', '#/learn/radicals'],
  ['area-hardwords', '#/learn/hardwords'],
  ['area-grammar', '#/learn/grammar'],
  ['area-profile', '#/extras/profile'],
  ['area-stats', '#/extras/stats'],
  ['area-progress', '#/extras/progress'],
  ['area-achievements', '#/extras/achievements'],
  ['area-paste', '#/extras/paste'],
  ['area-draw', '#/extras/draw'],
  ['area-pronounce', '#/extras/pronounce'],
  ['area-settings', '#/extras/settings'],
  ['area-backup', '#/extras/backup'],
  // New screens (t_ca3458fa): Anki, account, conversation, worksheet, plan,
  // exam, typing and the newer games — own route even before the hub lists them.
  ['area-worksheet', '#/extras/worksheet'],
  ['area-anki', '#/extras/anki'],
  ['area-account', '#/extras/account'],
  ['area-conversation', '#/extras/conversation'],
  ['area-plan', '#/learn/plan'],
  ['area-exam', '#/learn/exam'],
  ['area-typing', '#/learn/typing'],
  ['area-games-tones-duel', '#/learn/games/tones-duel'],
];

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page eval error');
    return r.result.value;
  }
  async waitFor(selector, timeout = 6000) {
    const t0 = Date.now();
    const sel = JSON.stringify(selector);
    while (Date.now() - t0 < timeout) {
      if (await this.eval(`!!document.querySelector(${sel})`)) return true;
      await sleep(100);
    }
    return false;
  }
  click(selector, index = 0) {
    return this.eval(`(()=>{const e=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!e)return false;e.click();return true;})()`);
  }
  count(selector) {
    return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }
  async shot(path) {
    const { writeFileSync } = await import('node:fs');
    const png = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(png.data, 'base64'));
  }
}

export async function startServer(dir) {
  if (process.env.CHINO_URL) return { base: process.env.CHINO_URL.replace(/\/$/, ''), stop() {} };
  const server = spawn('node', [SERVE, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let port = null;
  server.stdout.on('data', (d) => {
    const m = d.toString().match(/http:\/\/localhost:(\d+)/);
    if (m) port = m[1];
  });
  for (let i = 0; i < 80 && !port; i++) await sleep(100);
  if (!port) throw new Error(`serve.mjs did not report a port for ${dir}`);
  return { base: `http://localhost:${port}`, stop: () => server.kill() };
}

export async function launchChrome() {
  if (!CHROME) throw new Error('no Chrome found; set CHROME_BIN');
  const userDir = `/tmp/chino-audit-profile-${process.pid}`;
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let port = null;
  chrome.stderr.on('data', (d) => {
    const m = d.toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m) port = m[1];
  });
  for (let i = 0; i < 100 && !port; i++) await sleep(100);
  if (!port) throw new Error('Chrome did not expose a DevTools port');
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
        return { cdp: new CDP(ws), stop: () => chrome.kill() };
      }
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('could not connect to Chrome DevTools');
}

const SEED = `(async()=>{
  const srs = await import('./src/srs.js');
  const cards = [
    { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', source: 'dict' },
    { hanzi: '谢谢', pinyin: 'xiè xie', english: 'thank you', source: 'lesson' },
    { hanzi: '不客气', pinyin: 'bú kè qi', english: "you're welcome", source: 'lesson' },
  ];
  for (const c of cards) await srs.addToReview(c);
  return true;
})()`;

/** Run a lesson and call `view(name)` for each distinct exercise state. */
async function lessonFlow(cdp, view) {
  await cdp.eval("location.hash='#/learn/lessons/hsk1-01'");
  if (!(await cdp.waitFor('.lesson-intro'))) throw new Error('lesson intro missing');
  await view('lesson-intro');
  await cdp.click('.lesson-intro .btn.primary');
  await cdp.waitFor('.lesson-vocabulary');
  await sleep(250);
  await view('lesson-vocabulary');
  await cdp.click('.lesson-vocabulary > .btn.primary');
  const seen = new Set();
  let choose = 0;
  for (let step = 0; step < 14; step++) {
    await cdp.waitFor('.lesson-exercise, .lesson-result');
    await sleep(250);
    if (await cdp.count('.lesson-result')) { await view('lesson-result'); return; }
    const type = await cdp.eval(`(()=>{
      if (document.querySelector('.match-grid')) return 'match';
      if (document.querySelector('.answer-row')) return 'order';
      if (document.querySelector('.options')) return [...document.querySelectorAll('.exercise-body > .btn')].length ? 'listen' : 'choose';
      return 'unknown';
    })()`);
    if (!seen.has(type)) { seen.add(type); await view(`ex-${type}`); }
    if (type === 'choose' || type === 'listen') {
      await cdp.click('.options .btn');
      await sleep(350);
      if (choose < 2 || type === 'listen' && !seen.has('listen-fb')) {
        if (type === 'listen') seen.add('listen-fb');
        else choose += 1;
        await view(`ex-${type}-feedback-${type === 'choose' ? choose : 1}`);
      }
    } else if (type === 'order') {
      for (let i = 0; i < 8 && (await cdp.count('.pool-row .chip')); i++) await cdp.click('.pool-row .chip');
      await cdp.click('.exercise-body > .btn.primary');
      await sleep(350);
      if (!seen.has('order-fb')) { seen.add('order-fb'); await view('ex-order-feedback'); }
    } else if (type === 'match') {
      const n = await cdp.count('.match-col.left .chip');
      await cdp.click('.match-col.left .chip', 0);
      await sleep(150);
      await view('ex-match-selected');
      await cdp.click('.match-col.right .chip', 0);
      for (let i = 1; i < n; i++) {
        await cdp.click('.match-col.left .chip:not(.matched)', 0);
        await cdp.click('.match-col.right .chip:not(.matched)', 0);
      }
      await sleep(250);
      await view('ex-match-complete');
      await cdp.click('.exercise-body > .btn.primary');
      await sleep(350);
      await view('ex-match-feedback');
    } else {
      throw new Error('unknown exercise type');
    }
    await cdp.click('.feedback-box > .btn.primary');
  }
}

export async function runScenarios(dir, { widths = [390, 320], themes = ['light', 'dark'], locales = ['en', 'es'], onView, only } = {}) {
  const server = await startServer(dir);
  const { cdp, stop } = await launchChrome();
  const failures = [];
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    let seeded = false;
    for (const locale of locales) {
      await cdp.send('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
        acceptLanguage: locale === 'es' ? 'es-ES,es' : 'en-US,en',
      });
      for (const width of widths) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 700 : 844, deviceScaleFactor: 2, mobile: true });
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        for (const theme of themes) {
          await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          await cdp.send('Page.navigate', { url: `${server.base}/#/` });
          await cdp.waitFor('html[data-ready="true"]', 10000);
          await cdp.eval("location.reload()").catch(() => {});
          await sleep(300);
          await cdp.waitFor('html[data-ready="true"]', 10000);
          if (!seeded) { await cdp.eval(SEED); seeded = true; }
          if (process.env.FONTSCALE) await cdp.eval(`import('./src/settings.js').then((m) => m.setSetting('fontScale', ${Number(process.env.FONTSCALE)}))`);
          const ctx = { width, theme, locale, cdp };
          const view = async (name) => {
            await sleep(700); // let the entry animation finish
            try { await onView({ ...ctx, name }); } catch (err) { failures.push(`${name} ${locale} ${width} ${theme}: ${err.message}`); }
          };
          const go = async (hash, waitFor) => {
            await cdp.eval("location.hash='#/home'");
            await sleep(120);
            await cdp.eval(`location.hash=${JSON.stringify(hash)}`);
            if (waitFor && !(await cdp.waitFor(waitFor, 8000))) throw new Error(`${hash}: ${waitFor} never appeared`);
          };
          const wanted = (name) => !only || only.some((o) => name.startsWith(o));
          const run = async (label, fn) => {
            if (!wanted(label)) return;
            try { await fn(); } catch (err) { failures.push(`${label} ${locale} ${width} ${theme}: ${err.message}`); }
          };

          await run('home', async () => { await go('#/', '.home [data-role="wotd"]'); await view('home'); });
          await run('dictionary', async () => {
            await go('#/dictionary', '.dict-search input');
            await cdp.eval(`(()=>{const i=document.querySelector('.dict-search input');i.value='你';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
            await cdp.waitFor('.dict-row');
            await view('dictionary');
          });
          await run('review', async () => {
            await go('#/review', '.rv-list');
            await view('review-picker');
            await cdp.click('.rv-list .btn');
            await cdp.waitFor('.rv-card');
            await view('review-front');
            await cdp.click('.btn.primary.lg.block');
            await cdp.waitFor('.rv-ratings');
            await view('review-back');
          });
          await run('lesson', async () => lessonFlow(cdp, view));
          await run('read', async () => {
            await go('#/read', '.menu .card');
            await view('read-list');
            await go('#/read/reading-01', '.line');
            await cdp.click('[data-action="toggle-pinyin"]');
            await cdp.click('.word');
            await cdp.waitFor('.word-panel:not([hidden])');
            await view('read-panel');
          });
          // Every other area, reached by its own route (each hub dispatches on the
          // first segment). The integration task (HOME) adds the menu cards.
          for (const [label, hash] of AREAS) {
            await run(label, async () => {
              await go(hash, '.screen');
              await sleep(500);
              await view(label);
            });
          }
          await run('hub', async () => {
            await go('#/learn', '.menu [data-area]');
            await view('learn-hub');
            await go('#/extras', '.menu [data-area]');
            await view('more-hub');
          });
        }
      }
    }
  } finally {
    stop();
    server.stop();
  }
  return failures;
}

/** Runs in the page: contrast, component boundaries, touch targets, overflow. */
export const AUDIT_FN = `(function(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { g.clearRect(0,0,1,1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0,0,1,1); const d = g.getImageData(0,0,1,1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bottom) => { const a = top[3] + bottom[3] * (1 - top[3]); return a === 0 ? [0,0,0,0] : [0,1,2].map(i => (top[i]*top[3] + bottom[i]*bottom[3]*(1-top[3]))/a).concat(a); };
  const lum = (c) => { const f = [0,1,2].map(i => { const v = c[i]/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*f[0] + 0.7152*f[1] + 0.0722*f[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  const page = rgba(getComputedStyle(document.body).backgroundColor);
  const bgOf = (el) => { const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n); let acc = [0,0,0,0]; for (const n of chain) { const c = rgba(getComputedStyle(n).backgroundColor); acc = over(acc, c); if (acc[3] >= 0.999) break; } return acc[3] >= 0.999 ? acc : over(acc, page); };
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false; } return true; };
  const out = { contrast: [], boundary: [], targets: [], overflow: 0, texts: 0, controls: 0 };
  const label = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 18) + '"');
  out.overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('[disabled], [aria-disabled="true"], script, style')) continue;
    seen.add(el);
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    // composite text colour (may carry alpha) over its background
    const bg = bgOf(el);
    let fg = rgba(s.color); fg = over(fg, bg);
    const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const r = ratio(fg, bg);
    out.texts++;
    if (r < need) out.contrast.push({ el: label(el), ratio: Math.round(r*100)/100, need });
  }

  for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href]')) {
    if (!visible(el) || el.disabled) continue;
    out.controls++;
    const r = el.getBoundingClientRect();
    const exempt = el.classList.contains('word') || el.closest('.tabbar') && false;
    if (!exempt && (r.width < 43.5 || r.height < 43.5)) out.targets.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    const s = getComputedStyle(el);
    const boundaryNeeded = el.matches('input, select, textarea, .btn:not(.ghost), .chip');
    if (boundaryNeeded) {
      const parent = bgOf(el.parentElement || document.body);
      const own = over(rgba(s.backgroundColor), parent);
      const bw = parseFloat(s.borderTopWidth) || 0;
      const border = bw > 0 && s.borderTopStyle !== 'none' ? over(rgba(s.borderTopColor), parent) : null;
      const inset = /inset/.test(s.boxShadow) ? true : false;
      const best = Math.max(ratio(own, parent), border ? ratio(border, parent) : 1);
      if (best < 3 && !inset) out.boundary.push({ el: label(el), ratio: Math.round(best*100)/100 });
    }
  }
  return out;
})()`;
