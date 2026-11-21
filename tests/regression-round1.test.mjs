/**
 * regression-round1.test.mjs — mutation-killing tests for the REVIEW.md round-1
 * fixes that had NO test (docs/REVIEW-2.md I19): a revert of each fix must make
 * one of these fail.
 *
 * Covered here:
 *   #7  the SW precache must carry the lesson content (offline #/learn/lessons/*)
 *   #18 the OpenRouter stream must release its reader when the consumer stops
 * Run: node --test tests/regression-round1.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isShellAsset, SHELL_ASSET_RE } from '../scripts/lib/shell-assets.mjs';
import { createOpenRouterProvider } from '../src/chat/providers.js';

const ROOT = new URL('../', import.meta.url);
const src = (rel) => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8');

// ---------------------------------------------------------------- REVIEW #7
test('#7 precache: the shell assets include the lesson content, not the dictionary', () => {
  // The lesson index + every lesson JSON must be precached (offline lesson route).
  assert.equal(isShellAsset('src/main.js'), true);
  assert.equal(isShellAsset('icons/icon-192.png'), true);
  assert.equal(isShellAsset('data/lessons/hsk1/index.json'), true);
  assert.equal(isShellAsset('data/lessons/hsk1/lesson-01.json'), true);
  assert.equal(isShellAsset('data/es/lessons/hsk1/index.json'), true);
  assert.equal(isShellAsset('data/files.json'), true);
  assert.equal(isShellAsset('data/manifest.json'), true);
  // The big data stays in the runtime cache (a preview avoiding ~25 MB here).
  assert.equal(isShellAsset('data/dict/shards/000.json'), false);
  assert.equal(isShellAsset('data/es/dict/shards/000.json'), false);
  assert.equal(isShellAsset('data/strokes/index.json'), false);
  assert.equal(isShellAsset('data/sentences/shards/000.json'), false);
  assert.match(String(SHELL_ASSET_RE), /lessons/);

  // The build must inject the list into sw.js (a missing injection shipped a
  // stale/empty precache).
  const sw = src('sw.js');
  assert.match(sw, /SHELL_ASSETS/);
  const build = src('scripts/build.mjs');
  assert.match(build, /isShellAsset/);
  assert.match(build, /SHELL_ASSETS = /);
});

// --------------------------------------------------------------- REVIEW #18
test('#18 streaming: the reader is released when the consumer stops early', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const chunk = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk('你')));
      controller.enqueue(encoder.encode(chunk('好')));
      // Never closes: the consumer must cancel it (route change / abort).
    },
    cancel() {
      cancelled = true;
    },
  });
  const provider = createOpenRouterProvider({
    apiKey: 'sk-test',
    model: 'foo:free',
    fetchImpl: async () => new Response(body, { status: 200 }),
  });

  const stream = provider.send([{ role: 'user', content: 'hi' }]);
  const first = await stream.next();
  assert.equal(first.value, '你');
  await stream.return(); // stop early, like leaving the conversation screen
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true, 'the fetch body reader was cancelled');
});
