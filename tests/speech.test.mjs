import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  compare,
  hanziOnly,
  isRecognitionAvailable,
  listen,
} from '../src/speech.js';

let last = null;

/** Fake SpeechRecognition: records the instance so tests can drive its events. */
function installRecognition({ ctorName = 'SpeechRecognition', startThrows = false } = {}) {
  class FakeRecognition {
    constructor() {
      last = this;
      this.started = false;
      this.aborted = false;
    }
    start() {
      if (startThrows) throw new Error('nope');
      this.started = true;
    }
    abort() {
      this.aborted = true;
    }
    result(transcript, confidence = 0.9) {
      this.onresult({ results: [[{ transcript, confidence }]] });
    }
    error(code) {
      this.onerror({ error: code });
    }
    end() {
      this.onend();
    }
  }
  globalThis[ctorName] = FakeRecognition;
  return FakeRecognition;
}

function clearGlobals() {
  delete globalThis.SpeechRecognition;
  delete globalThis.webkitSpeechRecognition;
  last = null;
}

afterEach(clearGlobals);

/* ----------------------------- availability ----------------------------- */

test('isRecognitionAvailable is false without the browser globals', () => {
  assert.equal(isRecognitionAvailable(), false);
});

test('isRecognitionAvailable also accepts the webkit prefix', () => {
  installRecognition({ ctorName: 'webkitSpeechRecognition' });
  assert.equal(isRecognitionAvailable(), true);
});

/* -------------------------------- listen -------------------------------- */

test('listen degrades to unsupported without support', async () => {
  assert.deepEqual(await listen(), {
    ok: false,
    transcript: '',
    confidence: 0,
    reason: 'unsupported',
  });
});

test('listen starts recognition with the requested lang and resolves the transcript', async () => {
  installRecognition();
  const promise = listen({ lang: 'zh-TW' });
  assert.equal(last.started, true);
  assert.equal(last.lang, 'zh-TW');
  assert.equal(last.interimResults, false);
  last.result('你好', 0.75);
  assert.deepEqual(await promise, {
    ok: true,
    transcript: '你好',
    confidence: 0.75,
    reason: null,
  });
  assert.equal(last.aborted, true);
});

test('listen defaults to zh-CN and tolerates a missing confidence', async () => {
  installRecognition();
  const promise = listen();
  assert.equal(last.lang, 'zh-CN');
  last.onresult({ results: [[{ transcript: '你好' }]] });
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.confidence, 0);
});

test('listen maps permission errors to denied', async () => {
  installRecognition();
  const promise = listen();
  last.error('not-allowed');
  assert.deepEqual(await promise, {
    ok: false,
    transcript: '',
    confidence: 0,
    reason: 'denied',
  });

  installRecognition();
  const other = listen();
  last.error('service-not-allowed');
  assert.equal((await other).reason, 'denied');
});

test('listen maps other errors to error and silence to no-speech', async () => {
  installRecognition();
  const bad = listen();
  last.error('network');
  assert.equal((await bad).reason, 'error');

  installRecognition();
  const silent = listen();
  last.error('no-speech');
  assert.equal((await silent).reason, 'no-speech');
});

test('listen resolves no-speech when recognition ends without a result', async () => {
  installRecognition();
  const promise = listen();
  last.end();
  assert.deepEqual(await promise, {
    ok: false,
    transcript: '',
    confidence: 0,
    reason: 'no-speech',
  });
});

test('listen times out to no-speech', async () => {
  installRecognition();
  const result = await listen({ timeoutMs: 20 });
  assert.equal(result.reason, 'no-speech');
  assert.equal(last.aborted, true);
});

test('listen resolves error when start throws', async () => {
  installRecognition({ startThrows: true });
  assert.equal((await listen()).reason, 'error');
});

test('the first settled event wins (no double resolve)', async () => {
  installRecognition();
  const promise = listen();
  last.result('你好');
  last.error('network');
  last.end();
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.transcript, '你好');
});

/* -------------------------------- compare -------------------------------- */

test('hanziOnly keeps only hanzi characters', () => {
  assert.equal(hanziOnly('你好，世界！'), '你好世界');
  assert.equal(hanziOnly(' 你好 ma 3 '), '你好');
  assert.equal(hanziOnly('hello'), '');
  assert.equal(hanziOnly(null), '');
});

test('compare matches an exact hanzi string, ignoring punctuation and spaces', () => {
  assert.deepEqual(compare('你好', '你好'), { match: true, score: 1 });
  assert.deepEqual(compare('你好，世界！', ' 你好世界 '), { match: true, score: 1 });
  assert.deepEqual(compare('你好', '你好。'), { match: true, score: 1 });
});

test('compare scores partial matches without calling them a match', () => {
  const partial = compare('你好世界', '你好');
  assert.equal(partial.match, false);
  assert.equal(partial.score, 0.5);

  const close = compare('你好世界', '你好世纪'); // 3 of 4 hanzi survive
  assert.equal(close.score, 0.75);
  assert.equal(close.match, false);

  const nearMiss = compare('你好世界', '你好世界吗');
  assert.equal(nearMiss.score, 1, 'extra trailing hanzi are not penalised below 1');
  assert.equal(nearMiss.match, true);
});

test('compare on empty inputs is never a match', () => {
  assert.deepEqual(compare('', '你好'), { match: false, score: 0 });
  assert.deepEqual(compare('你好', ''), { match: false, score: 0 });
  assert.deepEqual(compare('', ''), { match: false, score: 0 });
  assert.deepEqual(compare('？', '你好'), { match: false, score: 0 });
  assert.deepEqual(compare(null, undefined), { match: false, score: 0 });
});

test('compare is symmetric enough for a substitution', () => {
  const swapped = compare('好你', '你好');
  assert.equal(swapped.match, false);
  assert.equal(swapped.score, 0.5);
});
