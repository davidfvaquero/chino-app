/**
 * audio.js — speak() using the app's own pre-generated Mandarin files, with the
 * browser's speechSynthesis as fallback.
 *
 * No UI, no strings: callers translate `reason` themselves with t().
 * Every path resolves (never throws) so callers can degrade gracefully.
 *
 * Order:
 *   1. the exact `text` in `public/audio/index.json`  -> play `<hash>.mp3`
 *   2. a text not in the index (or a file that fails) -> speechSynthesis, as before
 *
 * The index URL is always resolved against `document.baseURI`, so the app also
 * works from a GitHub Pages subdirectory (`/chino-app/`), never a hard-coded
 * '/audio/...'. The index is fetched lazily on the first speak and cached for
 * the session; a failed load is not cached, so it retries next time.
 *
 * Globals are read lazily (at call time), never at module load, so the
 * module is testable with mocks and harmless in a non-browser environment.
 */

const DEFAULT_LANG = 'zh-CN';
/** The default voice's index keys are the plain text; any other voice is
 *  prefixed as `<voice>:<text>` (see docs/AUDIO.md, the dialogues' speaker B). */
const DEFAULT_VOICE = 'a';

/** The <audio> element currently playing, so a new speak() can cancel it. */
let currentAudio = null;
/** Lazily loaded `{ text -> file }` index (a Promise, or null when not tried). */
let indexPromise = null;

/** True when the browser can speak. */
export function isTtsAvailable() {
  const synth = globalThis.speechSynthesis;
  return Boolean(
    synth &&
      typeof synth.speak === 'function' &&
      typeof globalThis.SpeechSynthesisUtterance === 'function'
  );
}

/**
 * URL of `audio/index.json`, resolved against the page's base so the same build
 * works at `/` and under a sub-path. Falls back to a bare relative name in a
 * non-browser environment (Node tests inject document/fetch themselves).
 */
function indexUrl() {
  const base =
    (typeof document !== 'undefined' && document.baseURI) || globalThis.location?.href || null;
  return base ? new URL('audio/index.json', base).href : 'audio/index.json';
}

/**
 * Lazily fetch and cache the index. Resolves to the `{ text -> file }` map, or
 * to null when it cannot be loaded (no fetch, bad URL, 404, broken JSON) — the
 * caller then falls back to TTS. Failures are not cached.
 */
function loadIndex() {
  if (!indexPromise) {
    if (typeof globalThis.fetch !== 'function') return Promise.resolve(null);
    indexPromise = Promise.resolve()
      .then(() => globalThis.fetch(indexUrl()))
      .then((res) => (res && res.ok === false ? null : res.json()))
      .catch(() => null);
    indexPromise.then((index) => {
      if (!index) indexPromise = null; // retry on the next speak
    });
  }
  return indexPromise;
}

/** Stop whatever file is playing. */
function stopAudio() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
  } catch {
    /* ignore */
  }
  currentAudio = null;
}

/**
 * Try the pre-generated file for `text`.
 *
 * @returns {Promise<{ok: true} | null>} null means "no file, use TTS".
 */
async function speakFile(text, rate, voice) {
  if (typeof globalThis.Audio !== 'function') return null;
  const index = await loadIndex();
  const key = voice && voice !== DEFAULT_VOICE ? `${voice}:${text}` : text;
  const file = index && index[key];
  if (!file) return null;

  let audio;
  try {
    audio = new globalThis.Audio(new URL(file, indexUrl()).href);
    if (typeof rate === 'number') {
      try {
        audio.playbackRate = rate;
      } catch {
        /* element without playbackRate: ignore the speed */
      }
    }
  } catch {
    return null;
  }
  try {
    globalThis.speechSynthesis?.cancel?.(); // a previous utterance must stop too
    stopAudio();
    currentAudio = audio;
    await audio.play();
    return { ok: true };
  } catch {
    stopAudio(); // a broken file falls back to TTS (and must not linger)
    return null;
  }
}

/** The original speechSynthesis path. */
function speakTts(value, lang, rate) {
  return new Promise((resolve) => {
    if (!isTtsAvailable()) return resolve({ ok: false, reason: 'unsupported' });
    try {
      const synth = globalThis.speechSynthesis;
      synth.cancel(); // cancel any audio already playing
      const utterance = new globalThis.SpeechSynthesisUtterance(value);
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.lang = lang;
      if (typeof rate === 'number') utterance.rate = rate;
      synth.speak(utterance);
      resolve({ ok: true });
    } catch {
      resolve({ ok: false, reason: 'error' });
    }
  });
}

/**
 * Speak `text`: the pre-generated file when the index has it, else the browser
 * voice. Same signature and same result shape as before.
 *
 * @param {string} text
 * @param {{lang?: string, rate?: number, voice?: string}} [opts]
 * @returns {Promise<{ok: true} | {ok: false, reason: 'unsupported'|'empty'|'error'}>}
 *          Resolves once the audio starts (or the utterance is queued).
 *          Never rejects, never throws.
 */
export function speak(text, { lang = DEFAULT_LANG, rate, voice } = {}) {
  const value = text == null ? '' : String(text);
  if (!value.trim()) return Promise.resolve({ ok: false, reason: 'empty' });
  return speakFile(value, rate, voice).then((played) => played ?? speakTts(value, lang, rate));
}

/**
 * Drop the cached index and stop any playing file. For tests and for callers
 * that switch origin/base at runtime; not needed in normal use.
 */
export function resetAudioCache() {
  stopAudio();
  indexPromise = null;
}

/** Normalise a BCP-47 tag for comparison: 'zh_CN' -> 'zh-cn'. */
function norm(tag) {
  return String(tag ?? '').toLowerCase().replace(/_/g, '-');
}

/**
 * Pick the best voice for `lang`: exact match, then same base language,
 * then nothing (browser default).
 */
function pickVoice(lang) {
  const voices = globalThis.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return null;
  const want = norm(lang);
  const base = want.split('-')[0];
  return (
    voices.find((v) => norm(v.lang) === want) ??
    voices.find((v) => norm(v.lang).startsWith(base)) ??
    null
  );
}
