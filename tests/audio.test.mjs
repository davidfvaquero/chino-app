import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isTtsAvailable, speak, resetAudioCache } from '../src/audio.js';

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

/** Minimal <audio> fake: records the src / playbackRate and whether play() ran. */
class FakeAudio {
  constructor(src) {
    this.src = src;
    this.paused = false;
    FakeAudio.instances.push(this);
  }
  play() {
    if (FakeAudio.failNext) {
      FakeAudio.failNext = false;
      return Promise.reject(new Error('boot'));
    }
    this.played = true;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
FakeAudio.instances = [];
FakeAudio.failNext = false;

/** Install the audio-file globals: fetch(index) + Audio + document.baseURI. */
function installFiles({ index = {}, baseURI = 'https://host/chino-app/', fetchImpl } = {}) {
  globalThis.document = { baseURI };
  globalThis.Audio = FakeAudio;
  globalThis.fetch =
    fetchImpl ??
    (async (url) => {
      if (String(url).endsWith('audio/index.json')) {
        return { ok: true, status: 200, json: async () => index };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  return FakeAudio.instances;
}

function clearGlobals() {
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
  delete globalThis.document;
  delete globalThis.Audio;
  globalThis.fetch = undefined; // no sessions/network in the pure-TTS tests
  FakeAudio.instances = [];
  FakeAudio.failNext = false;
  resetAudioCache();
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

test('speak plays the file when the text is in the index', async () => {
  const calls = installSynth();
  installFiles({ index: { 你好: 'abc123.mp3' } });
  assert.deepEqual(await speak('你好'), { ok: true });
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(FakeAudio.instances[0].src, 'https://host/chino-app/audio/abc123.mp3');
  assert.equal(FakeAudio.instances[0].played, true);
  assert.equal(calls.spoken.length, 0, 'the TTS must not run when a file played');
});

test('speak resolves the file URL against document.baseURI (subdirectory)', async () => {
  installFiles({ index: { 一: 'd274eee8a175062a.mp3' }, baseURI: 'https://host/chino-app/' });
  await speak('一');
  assert.equal(FakeAudio.instances[0].src, 'https://host/chino-app/audio/d274eee8a175062a.mp3');
});

test('speak applies rate to the file as playbackRate', async () => {
  installFiles({ index: { 你好: 'abc123.mp3' } });
  await speak('你好', { rate: 0.5 });
  assert.equal(FakeAudio.instances[0].playbackRate, 0.5);
});

test('speak stops the previous file when a new one starts', async () => {
  installFiles({ index: { 你好: 'a.mp3', 谢谢: 'b.mp3' } });
  await speak('你好');
  await speak('谢谢');
  assert.equal(FakeAudio.instances.length, 2);
  assert.equal(FakeAudio.instances[0].paused, true, 'the first file must be paused');
  assert.equal(FakeAudio.instances[1].paused, false);
});

test('speak falls back to the TTS for a text missing from the index', async () => {
  const calls = installSynth();
  installFiles({ index: { 你好: 'abc123.mp3' } });
  assert.deepEqual(await speak('谢谢'), { ok: true });
  assert.equal(FakeAudio.instances.length, 0);
  assert.equal(calls.spoken.length, 1);
  assert.equal(calls.spoken[0].text, '谢谢');
});

test('speak falls back to the TTS when the index cannot be loaded', async () => {
  const calls = installSynth();
  installFiles({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await speak('你好'), { ok: true });
  assert.equal(FakeAudio.instances.length, 0);
  assert.equal(calls.spoken[0].text, '你好');
});

test('speak falls back to the TTS on a non-ok index response', async () => {
  const calls = installSynth();
  installFiles({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  assert.deepEqual(await speak('你好'), { ok: true });
  assert.equal(FakeAudio.instances.length, 0);
  assert.equal(calls.spoken.length, 1);
});

test('speak falls back to the TTS when the file itself fails to play', async () => {
  const calls = installSynth();
  installFiles({ index: { 你好: 'broken.mp3' } });
  FakeAudio.failNext = true;
  assert.deepEqual(await speak('你好'), { ok: true });
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(FakeAudio.instances[0].paused, true, 'the broken element must be stopped');
  assert.equal(calls.spoken.length, 1);
  assert.equal(calls.spoken[0].text, '你好');
});

test('speak without a browser Audio falls back to the TTS', async () => {
  const calls = installSynth();
  globalThis.document = { baseURI: 'https://host/chino-app/' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ 你好: 'a.mp3' }) });
  assert.deepEqual(await speak('你好'), { ok: true });
  assert.equal(calls.spoken.length, 1);
});

test('the index is fetched once for many speaks', async () => {
  const urls = [];
  installFiles({
    index: { 你好: 'a.mp3', 谢谢: 'b.mp3' },
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ 你好: 'a.mp3', 谢谢: 'b.mp3' }) };
    },
  });
  await speak('你好');
  await speak('谢谢');
  assert.deepEqual(urls, ['https://host/chino-app/audio/index.json']);
});
