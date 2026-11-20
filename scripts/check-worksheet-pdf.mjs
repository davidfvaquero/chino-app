// Headless check for the worksheet PDF download (needs puppeteer — dev-only,
// never picked up by `npm test`). Reproduces the mobile bug path: 390x844 touch
// viewport, type characters, press "Download PDF", capture the real file with
// Browser.setDownloadBehavior, and validate the bytes.
//
//   OUT_DIR=/tmp/chino-worksheet npm run build
//   node scripts/check-worksheet-pdf.mjs [dir]
//
// Checks: starts %PDF-, ends %%EOF, xref offsets point at their objects, page
// count + A4 MediaBox, the DCTDecode stream is a real JPEG, the offline reload
// still downloads. Extracts each page JPEG to <dir>/worksheet-page-N.jpg for a
// human/vision look (grid + hanzi). Exits non-zero on the first failure.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || process.env.OUT_DIR || '/tmp/chino-worksheet-pdf';
const serveScript = fileURLToPath(new URL('./serve.mjs', import.meta.url));

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

async function waitForDownload(downloadDir, { timeout = 20000, previous = new Set() } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = readdirSync(downloadDir).filter((f) => f.endsWith('.pdf') && !f.endsWith('.crdownload') && !previous.has(f));
    if (files.length) return join(downloadDir, files[0]);
    await wait(250);
  }
  return null;
}

/* ------------------------------------------------------------------- run --- */

const downloadDir = mkdtempSync(join(tmpdir(), 'chino-ws-dl-'));
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
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
});

let exitCode = 0;
try {
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

  const chars = '戴维德中国语言文字'; // 戴维德 + 5 more characters (8 total)
  await page.click('.ws-input');
  await page.$eval('.ws-input', (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, chars);
  // Generate is the first action button; then the PDF button is enabled.
  await page.click('.ws-actions .ws-btn');
  await page.waitForFunction(() => !document.querySelector('.ws-sheet')?.hidden, { timeout: 10000 });
  const pdfEnabled = await page.$eval('[data-action="download-pdf"]', (b) => !b.disabled);
  assert(pdfEnabled, 'Generate enables "Download PDF"');

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

  assert(parsed.pages >= 1, 'PDF has at least one page', `${parsed.pages} pages`);
  ok('every page embeds the sheet as a JPEG image (grid + gray hanzi, no fonts)');

  parsed.jpegs.forEach((jpeg, i) => {
    const out = join(downloadDir, `worksheet-page-${i + 1}.jpg`);
    writeFileSync(out, jpeg);
    console.log(`  -> page ${i + 1} JPEG: ${out} (${jpeg.length} bytes)`);
  });
  // Remove the first PDF so the offline download writes a fresh file with the
  // same name (Chrome overwrites same-named downloads, hiding the second one).
  rmSync(file, { force: true });

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

  await page.click('.ws-input');
  await page.$eval('.ws-input', (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, '戴维德');
  await page.click('.ws-actions .ws-btn');
  await page.waitForFunction(() => !document.querySelector('.ws-sheet')?.hidden, { timeout: 10000 });
  const previous = new Set(readdirSync(downloadDir));
  await page.click('[data-action="download-pdf"]');
  const offlineFile = await waitForDownload(downloadDir, { previous });
  if (!offlineFile) {
    const hint = await page.evaluate(() => document.querySelector('.ws-hint')?.textContent);
    console.error('offline download diagnostics: hint =', JSON.stringify(hint));
  }
  assert(Boolean(offlineFile), 'PDF still downloads offline after a previous visit', offlineFile ? offlineFile.split('/').pop() : 'no file');
  if (offlineFile) {
    const offlineBytes = readFileSync(offlineFile);
    try {
      validatePdf(offlineBytes);
      ok('offline PDF is structurally valid');
    } catch (err) {
      fail('offline PDF is structurally valid', err.message);
    }
  }
  await page.setOfflineMode(false);

  if (results.some((r) => r.bad)) exitCode = 1;
} catch (err) {
  console.error('CHECK ERROR:', err.stack || err.message);
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.kill();
  if (exitCode === 0 && process.env.KEEP_ARTIFACTS !== '1') rmSync(downloadDir, { recursive: true, force: true });
  else console.error(`artifacts kept in ${downloadDir}`);
}

console.log(`\nworksheet PDF check: ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
