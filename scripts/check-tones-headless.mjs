// Headless smoke test for the Tones lesson (needs puppeteer — dev-only, not a
// runtime dependency). Moved here from tests/ (t_d10b8bf7) so `npm test` never
// picks it up. Run:  OUT_DIR=/tmp/chino-tones npm run build
//                    node scripts/check-tones-headless.mjs [dir]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const dir = process.argv[2] || process.env.OUT_DIR || 'dist';
const serveScript = fileURLToPath(new URL('./serve.mjs', import.meta.url));

// Same candidates as scripts/check-exercises.mjs (copied on purpose: this script
// must not depend on that file). Puppeteer's own Chrome cache may be missing.
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/home/homelab/.hermes/tools/chromium-1208/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const server = spawn('node', [serveScript, dir], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let port = null;
server.stdout.on('data', (data) => {
  const match = data.toString().match(/http:\/\/localhost:(\d+)/);
  if (match) port = match[1];
});

server.stderr.on('data', (data) => console.error('SERVER:', data.toString()));

await new Promise(r => setTimeout(r, 2000));

if (!port) {
  console.error('Server did not start');
  server.kill();
  process.exit(1);
}

console.log(`Server running on port ${port}`);

const { default: puppeteer } = await import('puppeteer');
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error(`no Chrome/Chromium found (tried: ${CHROME_CANDIDATES.join(', ')}). Set CHROME_BIN.`);
  server.kill();
  process.exit(1);
}
const browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log('BROWSER:', msg.text()));
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

/**
 * Clicks the first element matching `selector` from inside the page. A
 * coordinate click (`page.click`) lands on whatever overlaps the point when the
 * element is below the fold — which is how this smoke test used to hit the hub
 * nav instead of the "Continue" button. A programmatic click always targets the
 * element itself.
 */
const click = (selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`no element for ${s}`);
    el.click();
  }, selector);

/** Answers the current exercise: waits for the fresh (enabled) options — the
 * next step is drawn after saveProgress() resolves — then clicks the first. */
const answerCurrent = async () => {
  await page.waitForFunction(
    () => !!document.querySelector('.options .btn.option:not([disabled])'),
    { timeout: 3000 },
  );
  await page.evaluate(() => document.querySelector('.options .btn.option:not([disabled])').click());
};

try {
  // Navigate to learn/tones
  await page.goto(`http://localhost:${port}/#/learn/tones`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card.lesson-intro', { timeout: 5000 });

  // Check intro step
  const introTitle = await page.$eval('h2', el => el.textContent);
  console.log('Intro title:', introTitle);

  // Click Next to go to pinyin step
  await click('.card.lesson-intro .btn.primary');
  await page.waitForSelector('.card.lesson-pinyin', { timeout: 3000 });

  // Check pinyin step has tone explanations
  const toneItems = await page.$$('.tone-item');
  console.log('Tone items found:', toneItems.length);
  if (toneItems.length !== 5) throw new Error('Should have 5 tone items');

  // Click Next to go to vocabulary step
  await click('.card.lesson-pinyin .btn.primary');
  await page.waitForSelector('.card.lesson-vocabulary', { timeout: 3000 });

  // Check vocabulary items
  const vocabItems = await page.$$('.vocab-item');
  console.log('Vocab items found:', vocabItems.length);
  if (vocabItems.length !== 5) throw new Error('Should have 5 vocab items');

  // Click Next to go to exercises step
  await click('.card.lesson-vocabulary .btn.primary');
  await page.waitForSelector('.card.lesson-exercise', { timeout: 3000 });

  // First exercise: answer it.
  await page.waitForSelector('.options .btn.option', { timeout: 3000 });
  const options = await page.$$('.options .btn.option');
  console.log('Options found:', options.length);
  await answerCurrent();

  // Wait for feedback and continue
  await page.waitForSelector('.feedback-box .btn.primary', { timeout: 3000 });
  await click('.feedback-box .btn.primary');

  console.log('First exercise completed, continuing...');

  // Just verify we can progress through exercises
  for (let i = 1; i < 10; i++) {
    await page.waitForSelector('.card.lesson-exercise', { timeout: 3000 });
    await answerCurrent();
    await page.waitForSelector('.feedback-box .btn.primary', { timeout: 3000 });
    await click('.feedback-box .btn.primary');
    console.log(`Exercise ${i + 1} completed`);
  }

  // Should reach result step
  await page.waitForSelector('.card.lesson-result', { timeout: 5000 });
  const resultText = await page.$eval('.lesson-result h2', el => el.textContent);
  console.log('Result title:', resultText);

  const scoreText = await page.$eval('.lesson-result p', el => el.textContent);
  console.log('Score:', scoreText);

  // Click Finish — this saves progress, fires chino:lesson_done and sends the
  // learner back to the start of the Tones lesson.
  const eventPromise = page.evaluate(() => new Promise(resolve => {
    const handler = (e) => {
      window.removeEventListener('chino:lesson_done', handler);
      resolve(e.detail);
    };
    window.addEventListener('chino:lesson_done', handler);
    setTimeout(() => resolve(null), 2000);
  }));
  await click('.card.lesson-result .btn.primary');

  // Check the chino:lesson_done event fired (listener armed before Finish).
  const eventFired = await eventPromise;
  console.log('Lesson done event:', eventFired);
  if (!eventFired || eventFired.lessonId !== 'tones') throw new Error('chino:lesson_done did not fire for the tones lesson');

  console.log('SUCCESS: All headless checks passed');

} catch (err) {
  console.error('HEADLESS TEST FAILED:', err);
  await page.screenshot({ path: '/tmp/tones-error.png' });
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
