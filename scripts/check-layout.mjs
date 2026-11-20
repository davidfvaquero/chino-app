#!/usr/bin/env node
/**
 * scripts/check-layout.mjs — mobile layout guard for the hanzi/pinyin/english
 * cards (no npm dependencies).
 *
 * Starts scripts/serve.mjs on a build dir, launches headless Chrome, and for
 * every audited screen asserts *from the DOM* that:
 *   - the English/meaning element is NOT on the same line as the pinyin
 *     (english.top >= pinyin.bottom - 1) and there is >= MIN_GAP px of vertical
 *     separation;
 *   - no action button overlaps the pinyin/english text;
 *   - there is no horizontal overflow (documentElement.scrollWidth <= width).
 * Each screen is checked at 390px and 320px, in the light and dark theme.
 *
 * Usage:
 *   OUT_DIR=/tmp/chino-<id> npm run build
 *   node scripts/check-layout.mjs /tmp/chino-<id>
 *   CHINO_URL=http://localhost:1234 node scripts/check-layout.mjs   # reuse a server
 *
 * Exit code 0 = every check passed. Screenshots (when SHOTS_DIR is set) go to
 * $SHOTS_DIR/<name>-<width>-<theme>.png.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const dir = process.argv[2] || process.env.OUT_DIR || 'dist';
const WIDTHS = [390, 320];
const THEMES = ['light', 'dark'];
const MIN_GAP = 4; // px of vertical separation required between pinyin and english
const SHOTS_DIR = process.env.SHOTS_DIR || '';
const SERVE_SCRIPT = fileURLToPath(new URL('./serve.mjs', import.meta.url));

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/home/homelab/.hermes/tools/chromium-1208/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

/**
 * Audited screens. `cards` lists the card -> pinyin -> english selectors to
 * check; an empty `cards` still runs the overflow check. `optional: true`
 * screens are skipped (not failed) when they cannot render content (e.g. no
 * due cards for dictation).
 */
const ROUTES = [
  { name: 'home', hash: '#/', waitFor: '.home', cards: [
    { card: '.home [data-role="wotd"]', pinyin: '.pinyin', english: '.home-muted' },
  ] },
  { name: 'dictionary', hash: '#/dictionary', waitFor: '.dict-search', optional: true,
    steps: [{ fill: '.dict-search input', value: '你' }], waitFor2: '.dict-row',
    cards: [{ card: '.dict-row', pinyin: '.dict-pinyin', english: '.dict-defs' }] },
  { name: 'learn/lessons vocabulary', hash: '#/learn/lessons/hsk1-01', waitFor: '.lesson-intro',
    steps: [{ click: '.lesson-intro .btn.primary', waitFor: '.lesson-vocabulary' }],
    cards: [
      { card: '.vocab-item', pinyin: '.pinyin', english: '.english' },
      { card: '.vocab-item .example', pinyin: '.example-pinyin', english: '.example-english' },
    ] },
  { name: 'learn/themes', hash: '#/learn/themes/theme-01', waitFor: '.theme-row',
    cards: [{ card: '.theme-row', pinyin: '.pinyin', english: '.theme-meaning' }] },
  { name: 'learn/grammar', hash: '#/learn/grammar/shi', waitFor: '.gram-example', optional: true,
    cards: [{ card: '.gram-example', pinyin: '.pinyin', english: '.english' }] },
  { name: 'learn/sentences', hash: '#/learn/sentences', waitFor: '.sentence-card', optional: true,
    cards: [{ card: '.sentence-card', pinyin: '.sentence-pinyin', english: '.sentence-en' }] },
  { name: 'learn/dictation', hash: '#/learn/dictation', waitFor: '.dict-setup', optional: true,
    steps: [
      { click: '.dict-start', waitFor: '.dict-question' },
      { click: '.dict-reveal', waitFor: '.dict-answer-line' },
    ],
    cards: [{ card: '.dict-answer-line', pinyin: '.pinyin', english: '.english' }] },
  { name: 'learn/strokes sheet', hash: '#/learn/strokes/妈妈', waitFor: '.sheet-card',
    cards: [{ card: '.sheet-card', pinyin: '.sheet-pinyin', english: '.sheet-meaning' }] },
  { name: 'learn/hardwords', hash: '#/learn/hardwords', optional: true, cards: [] },
  { name: 'learn/radicals', hash: '#/learn/radicals', optional: true, cards: [] },
  { name: 'learn/games matching', hash: '#/learn/games/matching', optional: true, cards: [] },
  { name: 'learn/games memory', hash: '#/learn/games/memory', optional: true, cards: [] },
  { name: 'learn/games timed', hash: '#/learn/games/timed', optional: true, cards: [] },
  { name: 'read', hash: '#/read/reading-01', waitFor: '.line', optional: true,
    steps: [{ click: '[data-action="toggle-pinyin"]' }],
    cards: [{ card: '.line', pinyin: '.pinyin', english: '.english' }] },
  { name: 'extras/paste', hash: '#/extras/paste', waitFor: '.paste-wrap', optional: true, cards: [] },
  { name: 'extras/settings', hash: '#/extras/settings', optional: true, cards: [] },
  { name: 'extras/backup', hash: '#/extras/backup', optional: true, cards: [] },
  { name: 'extras/stats', hash: '#/extras/stats', optional: true, cards: [] },
  { name: 'extras/profile', hash: '#/extras/profile', optional: true, cards: [] },
  { name: 'extras/draw', hash: '#/extras/draw', optional: true, cards: [] },
  { name: 'extras/pronounce', hash: '#/extras/pronounce', optional: true, cards: [] },
  { name: 'learn/tones', hash: '#/learn/tones', optional: true, cards: [] },
  { name: 'learn/pinyin-chart', hash: '#/learn/pinyin-chart', optional: true, cards: [] },
  { name: 'learn/strokes', hash: '#/learn/strokes', optional: true, cards: [] },
  { name: 'learn/games matching', hash: '#/learn/games/matching', optional: true, cards: [] },
  { name: 'learn/games memory', hash: '#/learn/games/memory', optional: true, cards: [] },
  { name: 'learn/games timed', hash: '#/learn/games/timed', optional: true, cards: [] },
  { name: 'learn/games builder', hash: '#/learn/games/builder', optional: true, cards: [] },
  { name: 'learn/radicals', hash: '#/learn/radicals', optional: true, cards: [] },
  // New screens (t_ca3458fa): reachable by their own route.
  { name: 'extras/worksheet', hash: '#/extras/worksheet', optional: true, cards: [] },
  { name: 'extras/anki', hash: '#/extras/anki', optional: true, cards: [] },
  { name: 'extras/account', hash: '#/extras/account', optional: true, cards: [] },
  { name: 'extras/conversation', hash: '#/extras/conversation', optional: true, cards: [] },
  { name: 'learn/plan', hash: '#/learn/plan', optional: true, cards: [] },
  { name: 'learn/exam', hash: '#/learn/exam', optional: true, cards: [] },
  { name: 'learn/typing', hash: '#/learn/typing', optional: true, cards: [] },
  { name: 'learn/games tones-duel', hash: '#/learn/games/tones-duel', optional: true, cards: [] },
  // The two hubs (Aprender / Más) as tile grids.
  { name: 'learn hub', hash: '#/learn', waitFor: '.menu [data-area]', optional: true, cards: [] },
  { name: 'more hub', hash: '#/extras', waitFor: '.menu [data-area]', optional: true, cards: [] },
];

/* ------------------------------------------------------------------ CDP -- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve);
          ws.addEventListener('error', reject);
        });
        return new CDP(ws);
      }
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error('could not connect to Chrome DevTools');
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page eval error');
  return r.result.value;
}

async function waitFor(cdp, selector, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await evalJs(cdp, `!!document.querySelector(${JSON.stringify(selector)})`);
    if (ok) return true;
    await sleep(120);
  }
  return false;
}

const clickJs = (sel, index = 0) =>
  `(()=>{const els=document.querySelectorAll(${JSON.stringify(sel)});const el=els[${index}];if(!el)return false;el.click();return true;})()`;

const fillJs = (sel, value) =>
  `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`;

/** Runs in the page: returns { overflow, checked, failures }. */
const LAYOUT_FN = `(function(cfg){
  const out = { overflow: 0, checked: 0, failures: [] };
  out.overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  const hit = (a,b) => !(a.right <= b.left+0.5 || b.right <= a.left+0.5 || a.bottom <= b.top+0.5 || b.bottom <= a.top+0.5);
  for (const c of cfg.cards) {
    for (const card of document.querySelectorAll(c.card)) {
      const py = card.querySelector(c.pinyin);
      const en = card.querySelector(c.english);
      if (!py || !en) continue;
      const pr = py.getBoundingClientRect();
      const er = en.getBoundingClientRect();
      if (pr.height < 1 || er.height < 1) continue; // hidden -> nothing to check
      out.checked++;
      const gap = er.top - pr.bottom;
      if (er.top < pr.bottom - 1 || gap < cfg.minGap) {
        out.failures.push({ where: c.card, kind: 'english-not-below-pinyin', gap: Math.round(gap*10)/10 });
      }
      for (const btn of card.querySelectorAll('button')) {
        const br = btn.getBoundingClientRect();
        if (br.height < 1) continue;
        if (hit(br, er) || hit(br, pr)) out.failures.push({ where: c.card, kind: 'button-overlaps-text' });
      }
    }
  }
  return out;
})`;

/* ----------------------------------------------------------------- run -- */

let server = null;
async function startServer() {
  if (process.env.CHINO_URL) {
    return process.env.CHINO_URL.replace(/\/$/, '');
  }
  server = spawn('node', [SERVE_SCRIPT, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let port = null;
  server.stdout.on('data', (d) => {
    const m = d.toString().match(/http:\/\/localhost:(\d+)/);
    if (m) port = m[1];
  });
  for (let i = 0; i < 50 && !port; i++) await sleep(100);
  if (!port) throw new Error(`serve.mjs did not report a port for ${dir}`);
  return `http://localhost:${port}`;
}

function findChrome() {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) throw new Error(`no Chrome/Chromium found (tried: ${CHROME_CANDIDATES.join(', ')}). Set CHROME_BIN.`);
  return bin;
}

async function main() {
  const base = await startServer();
  console.log(`check-layout: serving ${base} (dir ${dir})`);

  const userDir = `/tmp/chino-layout-profile-${process.pid}`;
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let dbgPort = null;
  chrome.stderr.on('data', (d) => {
    const m = d.toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m) dbgPort = m[1];
  });
  for (let i = 0; i < 100 && !dbgPort; i++) await sleep(100);
  if (!dbgPort) throw new Error('Chrome did not expose a DevTools port');

  const cdp = await connect(dbgPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });

  if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });

  const results = [];
  let failed = 0;

  for (const width of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    for (const theme of THEMES) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: theme }],
      });
      for (const route of ROUTES) {
        const label = `${route.name} @${width} ${theme}`;
        const url = `${base}/${route.hash}`;
        let status = 'OK';
        let note = '';
        try {
          await cdp.send('Page.navigate', { url });
          await waitFor(cdp, 'html[data-ready="true"]', 8000);
          if (route.waitFor && !(await waitFor(cdp, route.waitFor, 6000))) {
            if (route.optional) { results.push({ label, status: 'SKIP', note: `no ${route.waitFor}` }); continue; }
            throw new Error(`waitFor ${route.waitFor} timed out`);
          }
          let stepFailed = false;
          for (const step of route.steps ?? []) {
            if (step.fill) await evalJs(cdp, fillJs(step.fill, step.value));
            if (step.click) await evalJs(cdp, clickJs(step.click, step.index ?? 0));
            if (step.waitFor && !(await waitFor(cdp, step.waitFor, 5000))) {
              if (route.optional) { stepFailed = true; break; }
              throw new Error(`step waitFor ${step.waitFor} timed out`);
            }
            await sleep(200);
          }
          if (stepFailed) { results.push({ label, status: 'SKIP', note: 'interactive step unavailable' }); continue; }
          if (route.waitFor2 && !(await waitFor(cdp, route.waitFor2, 5000))) {
            if (route.optional) { results.push({ label, status: 'SKIP', note: `no ${route.waitFor2}` }); continue; }
            throw new Error(`waitFor2 ${route.waitFor2} timed out`);
          }
          await sleep(250);
          const out = await evalJs(cdp, `(${LAYOUT_FN})(${JSON.stringify({ cards: route.cards, minGap: MIN_GAP })})`);
          if (out.overflow > 1) { status = 'FAIL'; note = `overflow ${out.overflow}px`; }
          if (out.failures.length) {
            status = 'FAIL';
            const seen = [...new Set(out.failures.map((f) => `${f.where} ${f.kind}${f.gap !== undefined ? `(${f.gap}px)` : ''}`))];
            note = `${out.failures.length} issue(s): ${seen.join(', ')}`;
          }
          if (status === 'OK') note = `${out.checked} card(s) checked`;
          if (SHOTS_DIR) {
            const shot = `${SHOTS_DIR}/${route.name.replace(/[^a-z0-9]+/gi, '-')}-${width}-${theme}.png`;
            const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
            const { writeFileSync } = await import('node:fs');
            writeFileSync(shot, Buffer.from(png.data, 'base64'));
          }
        } catch (err) {
          status = 'FAIL';
          note = String(err.message || err);
        }
        if (status === 'FAIL') failed++;
        results.push({ label, status, note });
        console.log(`  ${status.padEnd(4)} ${label.padEnd(42)} ${note}`);
      }
    }
  }

  chrome.kill();
  if (server) server.kill();

  const ok = results.filter((r) => r.status === 'OK').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\ncheck-layout: ${ok} OK, ${skipped} skipped, ${failed} failed (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('check-layout error:', err);
  if (server) server.kill();
  process.exit(1);
});
