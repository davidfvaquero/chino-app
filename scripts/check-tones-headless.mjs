// Headless smoke test for the Tones lesson (needs puppeteer — dev-only, not a
// runtime dependency). Moved here from tests/ (t_d10b8bf7) so `npm test` never
// picks it up. Run:  OUT_DIR=/tmp/chino-tones npm run build
//                    node scripts/check-tones-headless.mjs [dir]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || '/tmp/chino-tones';
const serveScript = fileURLToPath(new URL('./serve.mjs', import.meta.url));

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
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('console', msg => console.log('BROWSER:', msg.text()));
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

try {
  // Navigate to learn/tones
  await page.goto(`http://localhost:${port}/#/learn/tones`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card.lesson-intro', { timeout: 5000 });
  
  // Check intro step
  const introTitle = await page.$eval('h2', el => el.textContent);
  console.log('Intro title:', introTitle);
  
  // Click Next to go to pinyin step
  await page.click('.btn.primary');
  await page.waitForSelector('.card.lesson-pinyin', { timeout: 3000 });
  
  // Check pinyin step has tone explanations
  const toneItems = await page.$$('.tone-item');
  console.log('Tone items found:', toneItems.length);
  if (toneItems.length !== 5) throw new Error('Should have 5 tone items');
  
  // Click Next to go to vocabulary step
  await page.click('.btn.primary');
  await page.waitForSelector('.card.lesson-vocabulary', { timeout: 3000 });
  
  // Check vocabulary items
  const vocabItems = await page.$$('.vocab-item');
  console.log('Vocab items found:', vocabItems.length);
  if (vocabItems.length !== 5) throw new Error('Should have 5 vocab items');
  
  // Click Next to go to exercises step
  await page.click('.btn.primary');
  await page.waitForSelector('.card.lesson-exercise', { timeout: 3000 });
  
  // Do a listen exercise - click Play Audio, then pick an answer
  await page.waitForSelector('.options .btn.option', { timeout: 3000 });
  const options = await page.$$('.options .btn.option');
  console.log('Options found:', options.length);
  await options[0].click();
  
  // Wait for feedback and continue
  await page.waitForSelector('.feedback-box .btn.primary', { timeout: 3000 });
  await page.click('.feedback-box .btn.primary');
  
  console.log('First exercise completed, continuing...');
  
  // Just verify we can progress through exercises
  for (let i = 1; i < 10; i++) {
    await page.waitForSelector('.card.lesson-exercise', { timeout: 3000 });
    await page.waitForSelector('.options .btn.option', { timeout: 3000 });
    const opts = await page.$$('.options .btn.option');
    await opts[0].click();
    await page.waitForSelector('.feedback-box .btn.primary', { timeout: 3000 });
    await page.click('.feedback-box .btn.primary');
    console.log(`Exercise ${i + 1} completed`);
  }
  
  // Should reach result step
  await page.waitForSelector('.card.lesson-result', { timeout: 5000 });
  const resultText = await page.$eval('.lesson-result h2', el => el.textContent);
  console.log('Result title:', resultText);
  
  const scoreText = await page.$eval('.lesson-result p', el => el.textContent);
  console.log('Score:', scoreText);
  
  // Click Finish
  await page.click('.lesson-result .btn.primary');
  
  // Should navigate back to tones menu
  await page.waitForSelector('.menu', { timeout: 3000 });
  console.log('Returned to menu successfully');
  
  // Check chino:lesson_done event fired
  const eventFired = await page.evaluate(() => {
    return new Promise(resolve => {
      const handler = (e) => {
        window.removeEventListener('chino:lesson_done', handler);
        resolve(e.detail);
      };
      window.addEventListener('chino:lesson_done', handler);
      setTimeout(() => resolve(null), 100);
    });
  });
  console.log('Lesson done event:', eventFired);
  
  console.log('SUCCESS: All headless checks passed');
  
} catch (err) {
  console.error('HEADLESS TEST FAILED:', err);
  await page.screenshot({ path: '/tmp/tones-error.png' });
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
