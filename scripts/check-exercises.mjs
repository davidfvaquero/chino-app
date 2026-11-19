#!/usr/bin/env node
/**
 * scripts/check-exercises.mjs — touch/mobile guard for lesson exercises.
 *
 * Starts scripts/serve.mjs on a build dir, launches headless Chrome with mobile
 * emulation + touch events, and walks a real HSK1 lesson up to the MATCH
 * exercise. It then taps with Input.dispatchTouchEvent (not mouse clicks):
 *   - a word selects it;
 *   - a meaning pairs it;
 *   - tapping the pair again unselects it;
 *   - all four pairs can be completed and Check shows the result;
 *   - choose and order controls also respond to touch.
 * Every exercise button must be >= 44x44 px and there must be no horizontal
 * overflow. Runs at 390 and 320 px, light/dark, en/es.
 *
 * Usage:
 *   OUT_DIR=/tmp/chino-<id> npm run build
 *   node scripts/check-exercises.mjs /tmp/chino-<id>
 *   CHINO_URL=http://localhost:1234 node scripts/check-exercises.mjs
 *
 * Exit code 0 = every check passed. Screenshots go to
 * $SHOTS_DIR or /tmp/chino-<id>/shots.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] || process.env.OUT_DIR || '/tmp/chino-exercises';
const WIDTHS = [390, 320];
const THEMES = ['light', 'dark'];
const LOCALES = ['en', 'es'];
const MIN_TOUCH = 44;
const SHOTS_DIR = process.env.SHOTS_DIR || `${dir}/shots`;
const SERVE_SCRIPT = fileURLToPath(new URL('./serve.mjs', import.meta.url));

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/home/homelab/.hermes/tools/chromium-1208/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function connect(port) {
  for (let i = 0; i < 80; i++) {
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

async function waitFor(cdp, selector, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evalJs(cdp, `!!document.querySelector(${JSON.stringify(selector)})`)) return true;
    await sleep(120);
  }
  return false;
}

/** Centre of the nth element matching selector, or null. */
async function rectOf(cdp, selector, index = 0) {
  return evalJs(
    cdp,
    `(()=>{const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,text:el.textContent.trim()};})()`,
  );
}

/** Real touch tap: scroll into view, then touchStart + touchEnd at the centre. */
async function tap(cdp, selector, index = 0) {
  const found = await evalJs(
    cdp,
    `(()=>{const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!el)return false;el.scrollIntoView({block:'center',inline:'center'});return true;})()`,
  );
  if (!found) throw new Error(`tap: no element ${selector}[${index}]`);
  await sleep(120);
  const r = await rectOf(cdp, selector, index);
  if (!r) throw new Error(`tap: no element ${selector}[${index}]`);
  if (r.w < 1 || r.h < 1) throw new Error(`tap: element ${selector}[${index}] has no size`);
  const point = { x: Math.round(r.x), y: Math.round(r.y), id: 1, radiusX: 2, radiusY: 2, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(220);
  return r;
}

const count = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;

/** All buttons inside the exercise body, with sizes. */
async function buttonSizes(cdp) {
  return evalJs(
    cdp,
    `(()=>[...document.querySelectorAll('.exercise-body button')].map((b)=>{const r=b.getBoundingClientRect();return {text:b.textContent.trim().slice(0,24),w:Math.round(r.width),h:Math.round(r.height),cls:b.className};}))()`,
  );
}

async function overflow(cdp) {
  return evalJs(cdp, 'Math.max(0, document.documentElement.scrollWidth - window.innerWidth)');
}

async function shot(cdp, name) {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = `${SHOTS_DIR}/${name}.png`;
  writeFileSync(file, Buffer.from(png.data, 'base64'));
  return file;
}

/* ------------------------------------------------------------------ server -- */

let server = null;
async function startServer() {
  if (process.env.CHINO_URL) return process.env.CHINO_URL.replace(/\/$/, '');
  server = spawn('node', [SERVE_SCRIPT, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let port = null;
  server.stdout.on('data', (d) => {
    const m = d.toString().match(/http:\/\/localhost:(\d+)/);
    if (m) port = m[1];
  });
  for (let i = 0; i < 60 && !port; i++) await sleep(100);
  if (!port) throw new Error(`serve.mjs did not report a port for ${dir}`);
  return `http://localhost:${port}`;
}

function findChrome() {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) throw new Error(`no Chrome/Chromium found (tried: ${CHROME_CANDIDATES.join(', ')}). Set CHROME_BIN.`);
  return bin;
}

/* -------------------------------------------------------------------- flow -- */

async function loadLessonPairs(base, locale = 'en') {
  const path = locale === 'en' ? 'data/lessons/hsk1/lesson-01.json' : `data/${locale}/lessons/hsk1/lesson-01.json`;
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) throw new Error(`could not fetch ${path} (${res.status})`);
  const lesson = await res.json();
  const match = (lesson.exercises ?? []).find((e) => e.type === 'match');
  if (!match) throw new Error('lesson-01 has no match exercise');
  return match.pairs;
}

async function tapContinue(cdp) {
  await waitFor(cdp, '.feedback-box .btn.primary');
  await tap(cdp, '.feedback-box .btn.primary');
}

/** Walk intro -> vocabulary -> exercises and answer the first 3 exercises. */
async function reachMatch(cdp) {
  await tap(cdp, '.lesson-intro .btn.primary');
  if (!(await waitFor(cdp, '.lesson-vocabulary'))) throw new Error('vocabulary step did not appear');
  await tap(cdp, '.lesson-vocabulary .btn.primary');
  if (!(await waitFor(cdp, '.exercise-body'))) throw new Error('exercise step did not appear');

  // Exercise 1: choose. Tap the first option.
  await tap(cdp, '.exercise-body .options .btn', 0);
  await tapContinue(cdp);
  // Exercise 2: choose. Tap the second option.
  await tap(cdp, '.exercise-body .options .btn', 1);
  await tapContinue(cdp);
  // Exercise 3: listen. Tap the first option (no need to play audio).
  await tap(cdp, '.exercise-body .options .btn', 0);
  await tapContinue(cdp);
  // Exercise 4: match.
  if (!(await waitFor(cdp, '.match-grid'))) throw new Error('match exercise did not appear');
}

async function runMatch(cdp, pairs, label) {
  const failures = [];
  const sizes = await buttonSizes(cdp);
  for (const b of sizes) {
    if (b.w < MIN_TOUCH || b.h < MIN_TOUCH) failures.push(`button "${b.text}" ${b.w}x${b.h} < ${MIN_TOUCH}`);
  }
  const ov = await overflow(cdp);
  if (ov > 1) failures.push(`horizontal overflow ${ov}px`);

  const left = '.match-col.left button';
  const right = '.match-col.right button';

  // 1. tap a word -> selected
  await tap(cdp, left, 0);
  const selected = await evalJs(cdp, count('.match-chip.selected'));
  if (selected !== 1) failures.push(`tap word: expected 1 selected, got ${selected}`);

  // 2. tap a meaning -> pair marked
  await tap(cdp, right, 0);
  const matched = await evalJs(cdp, count('.match-chip.matched'));
  if (matched !== 2) failures.push(`tap meaning: expected 2 matched chips, got ${matched}`);

  // 3. tap the same word again -> unselected
  await tap(cdp, left, 0);
  const afterUnmatch = await evalJs(cdp, count('.match-chip.matched'));
  if (afterUnmatch !== 0) failures.push(`tap again: expected 0 matched chips, got ${afterUnmatch}`);

  // 4. complete all pairs using the lesson data
  for (const pair of pairs) {
    const leftIndex = await evalJs(
      cdp,
      `(()=>[...document.querySelectorAll(${JSON.stringify(left)})].findIndex((b)=>b.textContent.trim()===${JSON.stringify(pair.hanzi)}))()`,
    );
    if (leftIndex < 0) throw new Error(`match: no left button for ${pair.hanzi}`);
    await tap(cdp, left, leftIndex);
    const rightIndex = await evalJs(
      cdp,
      `(()=>[...document.querySelectorAll(${JSON.stringify(right)})].findIndex((b)=>b.textContent.trim()===${JSON.stringify(pair.english)}))()`,
    );
    if (rightIndex < 0) throw new Error(`match: no right button for ${pair.english}`);
    await tap(cdp, right, rightIndex);
  }

  const totalMatched = await evalJs(cdp, count('.match-chip.matched'));
  if (totalMatched !== pairs.length * 2) failures.push(`complete: expected ${pairs.length * 2} matched chips, got ${totalMatched}`);

  const checkDisabled = await evalJs(cdp, `document.querySelector('.exercise-body .btn.primary')?.disabled`);
  if (checkDisabled !== false) failures.push('Check stayed disabled after all pairs were matched');

  await shot(cdp, `${label}-match-complete`);
  await tap(cdp, '.exercise-body .btn.primary');
  await waitFor(cdp, '.feedback-box .feedback');
  const result = await evalJs(cdp, `document.querySelector('.feedback-box .feedback')?.className || ''`);
  if (!/feedback\s+ok/.test(result)) failures.push(`correct pairs: Check did not show ok (class "${result}")`);
  await shot(cdp, `${label}-match-result`);

  // order exercise follows match: tap a pool chip into the answer row and back.
  await tapContinue(cdp);
  await waitFor(cdp, '.answer-row');
  const poolBefore = await evalJs(cdp, count('.pool-row .chip'));
  await tap(cdp, '.pool-row .chip', 0);
  const poolAfter = await evalJs(cdp, count('.pool-row .chip'));
  const answerAfter = await evalJs(cdp, count('.answer-row .chip'));
  if (poolAfter !== poolBefore - 1 || answerAfter !== 1) {
    failures.push(`order touch failed (pool ${poolBefore}->${poolAfter}, answer ${answerAfter})`);
  }
  await tap(cdp, '.answer-row .chip', 0);
  const poolBack = await evalJs(cdp, count('.pool-row .chip'));
  if (poolBack !== poolBefore) failures.push(`order chip did not return to pool (${poolBack}/${poolBefore})`);

  return failures;
}

/* -------------------------------------------------------------------- main -- */

async function main() {
  const base = await startServer();
  console.log(`check-exercises: serving ${base}`);

  const userDir = `/tmp/chino-exercises-profile-${process.pid}`;
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
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const results = [];
  let failed = 0;

  for (const locale of LOCALES) {
    const pairs = await loadLessonPairs(base, locale);
    console.log(`  ${locale}: ${pairs.length} match pairs`);
    const script = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(navigator,'languages',{get:()=>['${locale}','${locale}-ES']});Object.defineProperty(navigator,'language',{get:()=>'${locale}'});`,
    });
    try {
      for (const width of WIDTHS) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width, height: 844, deviceScaleFactor: 2, mobile: true,
        });
        for (const theme of THEMES) {
          await cdp.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: theme }],
          });
          const label = `${locale}-${width}-${theme}`;
          try {
            await cdp.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
            await cdp.send('Page.navigate', { url: `${base}/?run=${Date.now()}#/learn/lessons/hsk1-01` });
            await waitFor(cdp, 'html[data-ready="true"]', 9000);
            if (!(await waitFor(cdp, '.lesson-intro'))) throw new Error('lesson intro did not load');
            await reachMatch(cdp);
            const failures = await runMatch(cdp, pairs, label);
            if (failures.length) {
              failed++;
              results.push({ label, status: 'FAIL', note: failures.join('; ') });
              console.log(`  FAIL ${label}: ${failures.join('; ')}`);
            } else {
              results.push({ label, status: 'OK', note: 'touch match/choose/order + 44px + no overflow' });
              console.log(`  OK   ${label}`);
            }
          } catch (err) {
            failed++;
            results.push({ label, status: 'FAIL', note: String(err.message || err) });
            console.log(`  FAIL ${label}: ${err.message || err}`);
          }
        }
      }
    } finally {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier }).catch(() => {});
    }
  }

  chrome.kill();
  if (server) server.kill();

  const ok = results.filter((r) => r.status === 'OK').length;
  console.log(`\ncheck-exercises: ${ok} OK, ${failed} failed (${results.length} checks)`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  if (server) server.kill();
  process.exit(1);
});
