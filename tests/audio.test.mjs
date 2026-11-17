import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isTtsAvailable, speak } from '../src/audio.js';

/** Minimal fakes for the Web Speech synthesis globals. */
function installSynth({ voices = [], onSpeak } = {}) {
  const calls = { cancel: 0, spoken: [] };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  globalThis.SpeechSynthesisUtterance = Utterance;
  globalThis.speechSynthesis = {
    getVoices: () => voices,
    cancel() {
      calls.cancel++;
    },
    speak(utterance) {
      calls.spoken.push(utterance);
      onSpeak?.(utterance);
    },
  };
  return calls;
}

function clearGlobals() {
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

afterEach(clearGlobals);

test('isTtsAvailable is false without the browser globals', () => {
  assert.equal(isTtsAvailable(), false);
});

test('isTtsAvailable is false when speechSynthesis is not callable', () => {
  globalThis.speechSynthesis = {};
  globalThis.SpeechSynthesisUtterance = class {};
  assert.equal(isTtsAvailable(), false);
});

test('isTtsAvailable is true with speechSynthesis + utterance', () => {
  installSynth();
  assert.equal(isTtsAvailable(), true);
});

test('speak without support resolves unsupported instead of throwing', async () => {
  const result = await speak('你好');
  assert.deepEqual(result, { ok: false, reason: 'unsupported' });
});

test('speak resolves ok and cancels previous audio before speaking', async () => {
  const calls = installSynth();
  const result = await speak('你好');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.cancel, 1);
  assert.equal(calls.spoken.length, 1);
  assert.equal(calls.spoken[0].text, '你好');
  assert.equal(calls.spoken[0].lang, 'zh-CN');
});

test('speak passes rate through only when given', async () => {
  const withRate = installSynth();
  await speak('你好', { rate: 0.5 });
  assert.equal(withRate.spoken[0].rate, 0.5);

  const withoutRate = installSynth();
  await speak('你好');
  assert.equal(withoutRate.spoken[0].rate, undefined);
  assert.equal(withoutRate.spoken[0].lang, 'zh-CN');
});

test('speak picks the Chinese voice when one exists', async () => {
  const zh = { lang: 'zh-CN', name: 'Chinese' };
  const en = { lang: 'en-US', name: 'English' };
  const calls = installSynth({ voices: [en, zh] });
  await speak('你好');
  assert.equal(calls.spoken[0].voice, zh);
});

test('speak falls back to the same base language, then to the default voice', async () => {
  const zhTw = { lang: 'zh-TW', name: 'Chinese TW' };
  const calls = installSynth({ voices: [{ lang: 'en-GB' }, zhTw] });
  await speak('你好');
  assert.equal(calls.spoken[0].voice, zhTw);

  const noChinese = installSynth({ voices: [{ lang: 'en-GB' }] });
  await speak('你好', { lang: 'zh-CN' });
  assert.equal(noChinese.spoken[0].voice, undefined);
  assert.equal(noChinese.spoken[0].lang, 'zh-CN');
});

test('speak handles a custom lang and empty input', async () => {
  const calls = installSynth();
  await speak('hi', { lang: 'en-US' });
  assert.equal(calls.spoken[0].lang, 'en-US');
  assert.equal(calls.spoken.length, 1);

  assert.deepEqual(await speak('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(await speak(null), { ok: false, reason: 'empty' });
  assert.equal(calls.cancel, 1, 'empty input must not touch the synth');
});

test('speak resolves error when the synth throws', async () => {
  installSynth({
    onSpeak() {
      throw new Error('boom');
    },
  });
  assert.deepEqual(await speak('你好'), { ok: false, reason: 'error' });
});
