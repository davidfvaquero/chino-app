/**
 * audio.js — thin wrapper over the Web Speech synthesis API (TTS).
 *
 * No UI, no strings: callers translate `reason` themselves with t().
 * Every path resolves (never throws) so callers can degrade gracefully.
 *
 * Globals are read lazily (at call time), never at module load, so the
 * module is testable with mocks and harmless in a non-browser environment.
 */

const DEFAULT_LANG = 'zh-CN';

/** True when the browser can speak. */
export function isTtsAvailable() {
  const synth = globalThis.speechSynthesis;
  return Boolean(
    synth &&
      typeof synth.speak === 'function' &&
      typeof globalThis.SpeechSynthesisUtterance === 'function'
  );
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

/**
 * Speak `text`.
 *
 * @param {string} text
 * @param {{lang?: string, rate?: number}} [opts]
 * @returns {Promise<{ok: true} | {ok: false, reason: 'unsupported'|'empty'|'error'}>}
 *          Resolves once the utterance is queued. Never rejects, never throws.
 */
export function speak(text, { lang = DEFAULT_LANG, rate } = {}) {
  return new Promise((resolve) => {
    const value = text == null ? '' : String(text);
    if (!value.trim()) return resolve({ ok: false, reason: 'empty' });
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
