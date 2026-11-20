/**
 * speech.js — thin wrapper over the Web Speech recognition API (STT) plus a
 * hanzi-only comparison helper.
 *
 * No UI, no strings: callers translate `reason` themselves with t().
 * Every path resolves (never throws) so callers can degrade gracefully.
 *
 * Globals are read lazily (at call time), never at module load, so the module
 * is testable with mocks and harmless in a non-browser environment.
 *
 * TTS lives in ./audio.js; this module only does recognition (STT).
 */

const DEFAULT_LANG = 'zh-CN';
const DEFAULT_TIMEOUT_MS = 10000;

/** CJK ideographs (BMP + extensions); everything else is ignored. */
const HANZI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/gu;

function RecognitionCtor() {
  return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
}

/** True when the browser exposes speech recognition. */
export function isRecognitionAvailable() {
  return typeof RecognitionCtor() === 'function';
}

/** Strip everything that is not a hanzi character (spaces, punctuation, pinyin, digits...). */
export function hanziOnly(text) {
  return (String(text ?? '').match(HANZI) ?? []).join('');
}

/** Longest common subsequence length (inputs are short). */
function lcs(a, b) {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = tmp;
    }
  }
  return row[b.length];
}

/**
 * Compare the expected hanzi with the transcript, ignoring everything that is
 * not hanzi.
 *
 * @returns {{match: boolean, score: number}} score in 0..1; `match` is true for
 *          an exact hanzi match or a close one (score >= 0.8).
 */
export function compare(expected, transcript) {
  const want = hanziOnly(expected);
  const got = hanziOnly(transcript);
  if (!want) return { match: false, score: 0 };
  if (want === got) return { match: true, score: 1 };
  if (!got) return { match: false, score: 0 };
  const score = lcs(want, got) / want.length;
  return { match: score >= 0.8, score };
}

function fail(reason) {
  return { ok: false, transcript: '', confidence: 0, reason };
}

/**
 * Listen once and resolve with what was recognised.
 *
 * @param {{lang?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, transcript: string, confidence: number,
 *                    reason: null|'unsupported'|'denied'|'no-speech'|'error'}>}
 *          Never rejects, never throws.
 */
export function listen({ lang = DEFAULT_LANG, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (!isRecognitionAvailable()) return resolve(fail('unsupported'));

    let recognition;
    try {
      recognition = new (RecognitionCtor())();
    } catch {
      return resolve(fail('error'));
    }

    let done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      try {
        recognition.abort?.();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    if (timeoutMs > 0) timer = setTimeout(() => finish(fail('no-speech')), timeoutMs);

    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const alt = event?.results?.[0]?.[0];
      finish({
        ok: true,
        transcript: alt?.transcript ?? '',
        confidence: alt?.confidence ?? 0,
        reason: null,
      });
    };
    recognition.onerror = (event) => {
      const code = event?.error;
      const reason =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'denied'
          : code === 'no-speech'
            ? 'no-speech'
            : 'error';
      finish(fail(reason));
    };
    recognition.onend = () => finish(fail('no-speech'));

    try {
      recognition.start();
    } catch {
      finish(fail('error'));
    }
  });
}

