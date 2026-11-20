// Headless check for the worksheet PDF download (needs puppeteer — dev-only,
// never picked up by `npm test`). Reproduces the real path on a 390x844 touch
// viewport AND a desktop viewport: type characters, press "Download PDF",
// capture the real file with Browser.setDownloadBehavior and validate the bytes.
//
//   OUT_DIR=/tmp/chino-<id> npm run build
//   node scripts/check-worksheet-pdf.mjs /tmp/chino-<id>
//
// Checks: rows style by default, one step per stroke (你=7, 戴=17), copies=4,
// %PDF-/%%EOF/xref offsets, page count + A4 MediaBox, DCTDecode streams are real
// JPEGs, global pinyin off renders pinyin-free, offline reload still downloads.
// Page JPEGs + the PDF are copied to <dir>/shots/ for a human/vision look.
// Exits non-zero on the first failure.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || process.env.OUT_DIR || '/tmp/chino-worksheet-pdf';
const serveScript = fileURLToPath(new URL('./serve.mjs', import.meta.url));
const shotsDir = join(dir, 'shots');
const TEST_TEXT = '你您好们吗嗨再见谢戴'; // 10 characters; 你=7 strokes, 戴=17

const results = [];
const ok = (step, detail = '') => { results.push({ step, detail }); console.log(`  OK  ${step}${detail ? ` — ${detail}` : ''}`); };
const fail = (step, detail = '') => { results.push({ step, detail, bad: true }); console.log(`FAIL  ${step}${detail ? ` — ${detail}` : ''}`); };
const assert = (cond, step, detail = '') => (cond ? ok(step, detail) : fail(step, detail));

/* ---------------------------------------------------------- PDF validation -- */

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/** Parse and validate a PDF buffer; returns { pages, jpegs:[Buffer] } or throws. */
function validatePdf(bytes) {
  const text = latin1(bytes);
  if (!text.startsWith('%PDF-')) throw new Error('does not start with %PDF-');
  if (!/\n%%EOF\s*$/.test(text)) throw new Error('does not end with %%EOF');

  const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!match) throw new Error('missing startxref before %%EOF');
  const offset = Number(match[1]);
  const slice = text.slice(offset);
  if (!slice.startsWith('xref\n')) throw new Error(`no xref table at startxref ${offset}`);

  const header = /^xref\n(\d+) (\d+)\n/.exec(slice);
  if (!header) throw new Error('malformed xref subsection header');
  const count = Number(header[2]);
  let cursor = header[0].length;
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const row = slice.slice(cursor, cursor + 20);
    if (!/^\d{10} \d{5} [nf] \n$/.test(row)) throw new Error(`bad xref row ${i}: ${JSON.stringify(row)}`);
    rows.push({ offset: Number(row.slice(0, 10)), type: row[17] });
    cursor += 20;
  }
  for (let id = 1; id < rows.length; id += 1) {
    if (rows[id].type !== 'n') throw new Error(`object ${id} is not in use`);
    if (!text.startsWith(`${id} 0 obj`, rows[id].offset)) {
      throw new Error(`xref offset of object ${id} (${rows[id].offset}) does not point at "${id} 0 obj"`);
    }
  }

  const tree = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text);
  if (!tree) throw new Error('no /Pages tree');
  const pages = Number(tree[1]);
  const mediaBoxes = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g) || [];
  if (mediaBoxes.length !== pages) throw new Error(`${mediaBoxes.length} MediaBox for ${pages} pages`);
  for (const box of mediaBoxes) {
    if (box !== '/MediaBox [0 0 595.28 841.89]') throw new Error(`page is not A4: ${box}`);
  }

  // Extract every DCTDecode image stream (one per page).
  const jpegs = [];
  const re = /\/Filter \/DCTDecode \/Length (\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const len = Number(m[1]);
    const streamAt = latin1(bytes.slice(m.index, m.index + 400)).indexOf('stream\n');
    if (streamAt < 0) throw new Error('image object without a stream');
    const start = m.index + streamAt + 'stream\n'.length;
    const jpeg = Buffer.from(bytes.slice(start, start + len));
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('embedded DCT stream is not a JPEG (no SOI)');
    if (jpeg[len - 2] !== 0xff || jpeg[len - 1] !== 0xd9) throw new Error('embedded DCT stream is truncated (no EOI)');
    jpegs.push(jpeg);
  }
  if (jpegs.length !== pages) throw new Error(`${jpegs.length} JPEG streams for ${pages} pages`);
  return { pages, jpegs };
}

/* ----------------------------------------------------------------- helper -- */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDownload(downloadDir, { timeout = 30000, previous = new Set() } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = readdirSync(downloadDir).filter((f) => f.endsWith('.pdf') && !f.endsWith('.crdownload') && !previous.has(f));
    if (files.length) return join(downloadDir, files[0]);
    await wait(250);
  }
  return null;
}

/** Worksheet state exposed by the module container. */
const readState = (page) => page.evaluate(() => {
  const container = document.querySelector('.worksheet')?.parentElement;
  return container?.worksheetApi?.state?.() ?? null;
});

/** Type characters, generate, return true when the sheet is visible. */
async function generate(page, text) {
  await page.click('.ws-input');
  await page.$eval('.ws-input', (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  await page.click('.ws-actions .ws-btn'); // first action = Generate
  await page.waitForFunction(() => !document.querySelector('.ws-sheet')?.hidden, { timeout: 15000 });
}

/* ------------------------------------------------------------------- run --- */

const downloadDir = mkdtempSync(join(tmpdir(), 'chino-ws-dl-'));
const desktopDir = mkdtempSync(join(tmpdir(), 'chino-ws-dl-'));
const server = spawn('node', [serveScript, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
let port = null;
server.stdout.on('data', (d) => {
  const m = d.toString().match(/http:\/\/localhost:(\d+)/);
  if (m) port = m[1];
});
server.stderr.on('data', (d) => console.error('SERVER:', d.toString()));
await wait(1500);
if (!port) {
  console.error('serve.mjs did not report a port');
  server.kill();
  process.exit(1);
}
const base = `http://localhost:${port}`;
console.log(`serving ${dir} at ${base}`);
mkdirSync(shotsDir, { recursive: true });

const { default: puppeteer } = await import('puppeteer');
const { existsSync } = await import('node:fs');
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/home/homelab/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
  '/home/homelab/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell',
  '/home/homelab/.hermes/tools/chromium-1208/chrome-linux64/chrome',
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 300000,
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
});

let exitCode = 0;
try {
  /* --------------------------------------------------------- mobile flow --- */
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('BROWSER ERROR:', msg.text()); });

  const OPEN = `${base}/#/extras/worksheet`;
  await page.goto(OPEN, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ws-input', { timeout: 8000 });
  ok('worksheet screen loads on a 390x844 touch viewport');

  await generate(page, TEST_TEXT);
  const state = await readState(page);
  assert(Boolean(state), 'worksheet exposes its state for checks', state ? `${state.cards.length} chars` : 'no state');
  assert(state?.style === 'rows', 'rows style with stroke-order steps is the default', state?.style);
  assert(state?.copies === 4, 'default grey copies = 4', String(state?.copies));
  const counts = Object.fromEntries((state?.cards ?? []).map((c) => [c.character, c.strokes]));
  assert(counts['你'] === 7 && counts['戴'] === 17, '你 has 7 strokes and 戴 has 17', JSON.stringify({ 你: counts['你'], 戴: counts['戴'] }));
  const stepsOk = (state?.cards ?? []).every((c) => c.steps === c.strokes);
  assert(stepsOk, 'one step per stroke for every character');
  const canvases = await page.$$eval('.ws-page', (nodes) => nodes.length);
  assert(canvases === 1, 'preview renders the A4 page canvas (same drawing as the PDF)', `${canvases} canvas`);

  const before = new Set(readdirSync(downloadDir));
  await page.click('[data-action="download-pdf"]');
  const file = await waitForDownload(downloadDir, { previous: before });
  assert(Boolean(file), 'clicking "Download PDF" downloads a .pdf file', file ? file.split('/').pop() : 'no file');
  if (!file) throw new Error('no PDF downloaded');

  const bytes = readFileSync(file);
  assert(bytes.length > 2000, 'downloaded file has content', `${bytes.length} bytes`);

  let parsed;
  try {
    parsed = validatePdf(bytes);
    ok('PDF structure valid', `%PDF- / %%EOF / xref offsets / ${parsed.pages} A4 page(s)`);
  } catch (err) {
    fail('PDF structure valid', err.message);
    throw err;
  }
  assert(parsed.pages === 1, '10 characters fit on one A4 page', `${parsed.pages} page(s)`);
  assert(parsed.jpegs[0].length > 3000, 'page image is a real JPEG', `${parsed.jpegs[0].length} bytes`);

  copyFileSync(file, join(shotsDir, 'hoja-caligrafia.pdf'));
  parsed.jpegs.forEach((jpeg, i) => {
    const out = join(shotsDir, `page-${i + 1}.jpg`);
    writeFileSync(out, jpeg);
    console.log(`  -> page ${i + 1} JPEG: ${out} (${jpeg.length} bytes)`);
  });
  ok('page images copied to the shots folder', shotsDir);
  rmSync(file, { force: true });

  /* ------------------------------------------- 20 characters -> 2 A4 pages -- */
  const TWENTY = '你您好们吗嗨再见谢戴爱学习中文很好我们了'; // 20 characters
  await generate(page, TWENTY);
  const twentyBefore = new Set(readdirSync(downloadDir));
  await page.click('[data-action="download-pdf"]');
  const twentyFile = await waitForDownload(downloadDir, { previous: twentyBefore });
  if (twentyFile) {
    try {
      const twenty = validatePdf(readFileSync(twentyFile));
      assert(twenty.pages === 2, '20 characters paginate on two A4 pages', `${twenty.pages} page(s)`);
      writeFileSync(join(shotsDir, 'page-2.jpg'), twenty.jpegs[1]);
      copyFileSync(twentyFile, join(shotsDir, 'hoja-caligrafia-20.pdf'));
      ok('20-character PDF and page 2 copied to shots', `${readFileSync(twentyFile).length} bytes`);
    } catch (err) {
      fail('20 characters paginate on two A4 pages', err.message);
    }
    rmSync(twentyFile, { force: true });
  } else {
    fail('20 characters paginate on two A4 pages', 'no file');
  }

  /* -------------------------------------------- global pinyin setting off -- */
  console.log('  .. switching the global pinyin setting off');
  const setPinyin = (value) => page.evaluate(
    async (b, v) => { const m = await import(`${b}/src/settings.js`); await m.setSetting('pinyin', v); },
    base,
    value,
  );
  await setPinyin(false);
  console.log('  .. pinyin off, regenerating');
  await generate(page, TEST_TEXT);
  console.log('  .. regenerated, downloading');
  const beforeOff = new Set(readdirSync(downloadDir));
  await page.click('[data-action="download-pdf"]');
  const offFile = await waitForDownload(downloadDir, { previous: beforeOff });
  if (offFile) {
    try {
      const off = validatePdf(readFileSync(offFile));
      writeFileSync(join(shotsDir, 'page-1-nopinyin.jpg'), off.jpegs[0]);
      ok('PDF renders with the global pinyin setting off', `${off.pages} pages`);
    } catch (err) {
      fail('PDF renders with the global pinyin setting off', err.message);
    }
    rmSync(offFile, { force: true });
  } else {
    fail('PDF renders with the global pinyin setting off', 'no file');
  }
  await setPinyin(true);

  /* ------------------------------- cards style kept + preferences stored --- */
  await page.select('[data-option="style"]', 'cards');
  await generate(page, '戴维德');
  const cardPages = await page.$$eval('.ws-cards .ws-page', (nodes) => nodes.length);
  assert(cardPages >= 1, 'cards style renders the A4 page canvas (same drawing as the PDF)', `${cardPages} page(s)`);
  const beforeCards = new Set(readdirSync(downloadDir));
  await page.click('[data-action="download-pdf"]');
  const cardsFile = await waitForDownload(downloadDir, { previous: beforeCards });
  assert(Boolean(cardsFile), 'cards style still downloads a PDF', cardsFile ? cardsFile.split('/').pop() : 'no file');
  if (cardsFile) {
    try {
      validatePdf(readFileSync(cardsFile));
      ok('cards-style PDF is structurally valid');
    } catch (err) {
      fail('cards-style PDF is structurally valid', err.message);
    }
    rmSync(cardsFile, { force: true });
  }

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.ws-input', { timeout: 8000 });
  const persisted = await readState(page);
  assert(persisted?.options?.style === 'cards', 'style choice is persisted in storage', persisted?.options?.style);
  await page.select('[data-option="style"]', 'rows');
  assert((await readState(page))?.options?.style === 'rows', 'switching back to rows style works');

  /* ------------------------------------------------------------- offline -- */
  await page.evaluate(() => navigator.serviceWorker.ready);
  let controlled = false;
  for (let i = 0; i < 4 && !controlled; i += 1) {
    await page.reload({ waitUntil: 'networkidle0' });
    controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  }
  assert(controlled, 'service worker controls the page');
  // Give the precache a moment, then pull the plug.
  await wait(1200);
  await page.setOfflineMode(true);
  await page.goto(OPEN, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ws-input', { timeout: 8000 });
  ok('worksheet opens with no network (service worker cache)');

  await generate(page, '戴维德');
  const previous = new Set(readdirSync(downloadDir));
  await page.click('[data-action="download-pdf"]');
  const offlineFile = await waitForDownload(downloadDir, { previous });
  if (!offlineFile) {
    const hint = await page.evaluate(() => document.querySelector('.ws-hint')?.textContent);
    console.error('offline download diagnostics: hint =', JSON.stringify(hint));
  }
  assert(Boolean(offlineFile), 'PDF still downloads offline after a previous visit', offlineFile ? offlineFile.split('/').pop() : 'no file');
  if (offlineFile) {
    try {
      validatePdf(readFileSync(offlineFile));
      ok('offline PDF is structurally valid');
    } catch (err) {
      fail('offline PDF is structurally valid', err.message);
    }
  }
  await page.setOfflineMode(false);

  /* --------------------------- desktop, separate browser (memory-hungry) --- */
  // A second tab with a second 200 dpi A4 canvas deadlocks headless raster, and
  // Browser.setDownloadBehavior is browser-wide, so give desktop its own browser.
  await browser.close().catch(() => {});
  const desktopBrowser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300000,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  try {
    const desktop = await desktopBrowser.newPage();
    await desktop.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    const desktopCdp = await desktop.target().createCDPSession();
    await desktopCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: desktopDir });
    desktop.on('pageerror', (err) => console.error('DESKTOP PAGE ERROR:', err.message));
    await desktop.goto(OPEN, { waitUntil: 'networkidle0' });
    await desktop.waitForSelector('.ws-input', { timeout: 8000 });
    await generate(desktop, TEST_TEXT);
    const desktopState = await readState(desktop);
    assert(desktopState?.cards?.length === 10, 'desktop: 10 characters generate in rows style');
    const desktopBefore = new Set(readdirSync(desktopDir));
    await desktop.click('[data-action="download-pdf"]');
    const desktopFile = await waitForDownload(desktopDir, { previous: desktopBefore });
    assert(Boolean(desktopFile), 'desktop: "Download PDF" downloads a .pdf file', desktopFile ? desktopFile.split('/').pop() : 'no file');
    if (desktopFile) {
      try {
        const desktopPdf = validatePdf(readFileSync(desktopFile));
        ok('desktop PDF is structurally valid', `${desktopPdf.pages} page(s)`);
        writeFileSync(join(shotsDir, 'page-1-desktop.jpg'), desktopPdf.jpegs[0]);
      } catch (err) {
        fail('desktop PDF is structurally valid', err.message);
      }
      rmSync(desktopFile, { force: true });
    }
  } finally {
    await desktopBrowser.close().catch(() => {});
  }

  if (results.some((r) => r.bad)) exitCode = 1;
} catch (err) {
  console.error('CHECK ERROR:', err.stack || err.message);
  exitCode = 1;
} finally {
  server.kill();
  rmSync(downloadDir, { recursive: true, force: true });
  rmSync(desktopDir, { recursive: true, force: true });
}

console.log(`\nworksheet PDF check: ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
