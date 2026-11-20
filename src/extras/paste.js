/**
 * Paste & Analyze — paste Chinese text, segment into words, show pinyin + meanings.
 *
 * `#/extras/paste` — large textarea, "Analyze" button, segmented words with colored
 * pinyin (toggle), tap a word for meaning panel + "add to review", TTS for whole
 * text or per sentence, unknown-word counter (not in HSK1 nor in SRS review deck).
 * Long text is chunked to keep the UI responsive. Last text is persisted.
 *
 * Reuses pure logic from src/reading/model.js and src/screens/read.js patterns.
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import * as dictionary from '../dictionary.js';
import { addToReview, listCards } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { pinyinToggle } from '../settings.js';
import { tokenizeLine, wordPanel, reviewEntryFrom, hasHanzi } from '../reading/model.js';
import storage from '../storage.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'paste.title';

const STYLE_ID = 'paste-style';
const CSS = `
.paste-wrap { display: flex; flex-direction: column; gap: 0.75rem; height: 100%; }
.paste-textarea {
  width: 100%; min-height: 160px; max-height: 40vh;
  padding: 0.75rem; border: 1.5px solid var(--edge); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); font: inherit; resize: vertical;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
}
.paste-textarea:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.paste-toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.paste-btn {
  flex: 1; min-width: 100px; min-height: 48px; padding: 0.6rem 0.9rem;
  border: 1.5px solid var(--edge); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); font: inherit;
}
.paste-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.paste-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.paste-result { display: flex; flex-direction: column; gap: 0.5rem; }
.paste-line { display: flex; flex-direction: column; gap: 0.25rem; }
.paste-line.sentence { border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; }
.paste-hanzi { display: flex; flex-wrap: wrap; gap: 0.25rem; line-height: 2; }
.paste-word {
  display: inline-flex; flex-direction: column; align-items: center; gap: 0.1rem;
  padding: 0.15rem 0.3rem; border: 1px solid transparent; border-radius: 0.4rem;
  background: transparent; color: var(--ink); font: inherit; text-decoration: none;
  min-width: 2rem; cursor: pointer;
}
.paste-word:hover { background: var(--inset); border-color: var(--edge); }
.paste-word:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.paste-word .hanzi { font-size: 1.125rem; line-height: 1.2; }
.paste-word .pinyin { font-size: 0.7rem; line-height: 1; white-space: nowrap; }
.paste-punct { display: inline-flex; align-items: center; font-size: 1.125rem; color: var(--ink-soft); }
.paste-english { font-size: 0.8125rem; color: var(--ink-soft); margin-top: 0.25rem; }
.paste-sentence-controls { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
.paste-sentence-btn { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
.paste-panel {
  position: fixed; inset: auto 0 0 0; z-index: 10;
  padding: 1rem; background: var(--surface); border-top: 1px solid var(--line);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  max-height: 60vh; overflow-y: auto;
  animation: paste-slide-up 0.2s ease-out;
}
@keyframes paste-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.paste-panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.paste-panel-hanzi { font-size: 2rem; font-weight: 600; }
.paste-panel-pinyin { font-size: 1rem; color: var(--ink-soft); }
.paste-panel-defs { margin: 0.75rem 0; }
.paste-panel-defs li { margin: 0.25rem 0; }
.paste-panel-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.paste-panel-btn { flex: 1; min-width: 100px; padding: 0.6rem; font: inherit; }
.paste-unknown { font-size: 0.8125rem; color: var(--accent); margin-top: 0.5rem; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

const STORAGE_KEY = 'pasteLastText';

/** Load HSK1 vocabulary into a Set for fast unknown-word checking.
 *  Reloaded when the UI language changes (the list carries a meaning per language). */
let hsk1Set = null;
let hsk1Locale = null;
async function loadHSK1() {
  const locale = getLocale();
  if (hsk1Set && hsk1Locale === locale) return hsk1Set;
  try {
    const data = await fetchData('hsk/1.json');
    hsk1Set = new Set(data.items.map(item => item.hanzi));
  } catch {
    hsk1Set = new Set();
  }
  hsk1Locale = locale;
  return hsk1Set;
}

/** Load all words currently in the SRS review deck. */
async function loadReviewWords() {
  const cards = await listCards();
  const set = new Set();
  for (const card of cards) {
    if (card.hanzi) set.add(card.hanzi);
  }
  return set;
}

/** Check if a word is "known" (in HSK1 or in review deck). */
async function isKnown(word, hsk1, review) {
  return hsk1.has(word) || review.has(word);
}

/** Split text into sentences (by Chinese punctuation). */
export function splitSentences(text) {
  // Split on Chinese sentence endings, keep the delimiter
  return text.split(/([。！？；])/).reduce((acc, part, i, arr) => {
    if (i % 2 === 0) {
      const sentence = part + (arr[i + 1] || '');
      if (sentence.trim()) acc.push(sentence);
    }
    return acc;
  }, []);
}

/** Process a chunk of text: segment -> tokenize lines -> build DOM. */
async function processChunk(text, hsk1, review, ttsOk, onWordTap, onPlaySentence) {
  // Split into sentences for per-sentence controls
  const sentences = splitSentences(text);
  const lines = [];

  for (let si = 0; si < sentences.length; si++) {
    const sentence = sentences[si];
    const tokens = await tokenizeLine(sentence, dictionary.segment);
    let unknownCount = 0;

    const wordElements = tokens.map(({ text, word }) => {
      if (!word) {
        return h('span', { class: 'paste-punct' }, text);
      }
      const isUnknown = !hsk1.has(text) && !review.has(text);
      if (isUnknown) unknownCount++;
      return h('button', {
        type: 'button',
        class: 'paste-word' + (isUnknown ? ' unknown' : ''),
        'data-word': text,
        onclick: () => onWordTap(text),
      },
        h('span', { class: 'hanzi', text }),
        h('span', { class: 'pinyin' }),
      );
    });

    const hanziRow = h('p', { class: 'paste-hanzi' }, ...wordElements);

    // Fill in pinyin for each word (async, non-blocking)
    for (const [idx, { text, word }] of tokens.entries()) {
      if (!word) continue;
      const entry = await dictionary.lookup(text);
      const pinyin = entry?.pinyinTone || entry?.pinyin || '';
      const wordBtn = wordElements[idx];
      if (wordBtn) {
        const pinyinSpan = wordBtn.querySelector('.pinyin');
        if (pinyinSpan) {
          pinyinSpan.innerHTML = pinyinHtml(pinyin);
        }
      }
    }

    const englishRow = h('p', { class: 'paste-english' }); // could add translation later

    const controls = ttsOk
      ? h('div', { class: 'paste-sentence-controls' },
          h('button', {
            type: 'button',
            class: 'paste-btn paste-sentence-btn',
            text: t('paste.playSentence'),
            onclick: () => speak(sentence, { lang: 'zh-CN', rate: 0.9 }),
          })
        )
      : null;

    lines.push(h('div', { class: 'paste-line sentence', 'data-sentence': si }, hanziRow, englishRow, controls));
  }

  return lines;
}

export async function render(container, ctx) {
  ensureStyles(document);

  // State
  let lastText = '';
  let isAnalyzing = false;
  let hsk1 = new Set();
  let review = new Set();
  let ttsOk = isTtsAvailable();
  let currentPanelWord = null;

  // UI elements
  const textarea = h('textarea', {
    class: 'paste-textarea',
    placeholder: t('paste.placeholder'),
    'aria-label': t('paste.placeholder'),
  });

  const analyzeBtn = h('button', {
    type: 'button',
    class: 'paste-btn primary',
    text: t('paste.analyze'),
    onclick: onAnalyze,
  });

  const pinyinBtn = pinyinToggle();

  const playAllBtn = h('button', {
    type: 'button',
    class: 'paste-btn',
    text: t('paste.playAll'),
    disabled: !ttsOk,
    onclick: () => speak(lastText, { lang: 'zh-CN', rate: 0.9 }),
  });

  const toolbar = h('div', { class: 'paste-toolbar' }, analyzeBtn, pinyinBtn, playAllBtn);

  const resultWrap = h('div', { class: 'paste-result' });

  const panel = h('aside', { class: 'paste-panel', hidden: true, 'data-role': 'panel' });

  reset(container).append(
    h('section', { class: 'paste-wrap' },
      h('header', { class: 'app-header' }, t(titleKey)),
      h('main', { class: 'screen' },
        textarea,
        toolbar,
        h('p', { class: 'muted', text: t('paste.tapWord') }),
        resultWrap,
      ),
      panel,
    ),
  );

  // Load last saved text
  try {
    const saved = await storage.get('meta', STORAGE_KEY);
    if (saved) {
      textarea.value = saved;
      lastText = saved;
    }
  } catch {}

  // Preload HSK1 and review deck
  Promise.all([loadHSK1(), loadReviewWords()]).then(([h, r]) => {
    hsk1 = h;
    review = r;
    updateUnknownCount();
  });

  container.focus({ preventScroll: true });

  // --- Handlers ---

  async function onAnalyze() {
    const text = textarea.value.trim();
    if (!text) return;
    if (isAnalyzing) return;

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = t('paste.analyzing');
    reset(resultWrap);

    try {
      lastText = text;
      await storage.set('meta', STORAGE_KEY, text);

      // Process in chunks to not block UI
      const sentences = splitSentences(text);
      for (let i = 0; i < sentences.length; i++) {
        const chunkLines = await processChunk(
          sentences[i],
          hsk1,
          review,
          ttsOk,
          showWordPanel,
          null
        );
        for (const line of chunkLines) resultWrap.append(line);
        // Yield to event loop
        await new Promise(r => setTimeout(r, 0));
      }

      updateUnknownCount();
      playAllBtn.disabled = !ttsOk;
    } catch (err) {
      console.error('paste: analyze failed', err);
      resultWrap.append(h('p', { class: 'error', text: t('paste.error') }));
    } finally {
      isAnalyzing = false;
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = t('paste.analyze');
    }
  }

  function updateUnknownCount() {
    // Count unknown words in current result
    let unknown = 0;
    for (const wordBtn of resultWrap.querySelectorAll('.paste-word.unknown')) {
      unknown++;
    }
    // Remove any existing counter
    const existing = resultWrap.querySelector('.paste-unknown');
    if (existing) existing.remove();
    if (unknown > 0) {
      const key = unknown === 1 ? 'paste.unknownCount_one' : 'paste.unknownCount_other';
      resultWrap.append(h('p', { class: 'paste-unknown' }, t(key, { count: unknown })));
    }
  }

  async function showWordPanel(word) {
    currentPanelWord = word;
    const entry = await dictionary.lookup(word);
    const vm = wordPanel(word, entry);

    const reviewBtn = vm.found
      ? h('button', {
          type: 'button',
          class: 'paste-panel-btn primary',
          text: t('paste.addToReview'),
          onclick: async (e) => {
                        const btn = e.currentTarget;
                        await addToReview(reviewEntryFrom(entry, 'paste'));
                        btn.disabled = true;
                        btn.textContent = t('paste.added');
                        // Update review set and unknown count
                        review.add(word);
                        // Remove unknown class from word buttons FIRST, then update count
                        for (const wb of resultWrap.querySelectorAll(`.paste-word[data-word="${word}"]`)) {
                          wb.classList.remove('unknown');
                        }
                        updateUnknownCount();
                      },
        })
      : null;

    const playBtn = ttsOk
      ? h('button', {
          type: 'button',
          class: 'paste-panel-btn',
          text: t('paste.playSentence'),
          onclick: () => speak(word, { lang: 'zh-CN', rate: 0.8 }),
        })
      : null;

    reset(panel);
    panel.hidden = false;
    panel.append(
      h('div', { class: 'paste-panel-header' },
        h('h3', { class: 'paste-panel-hanzi', text: vm.hanzi }),
        h('button', {
          type: 'button',
          class: 'pill',
          text: t('paste.close'),
          onclick: () => { panel.hidden = true; currentPanelWord = null; },
        }),
      ),
      vm.found
        ? h('p', { class: 'paste-panel-pinyin py-keep', html: pinyinHtml(vm.pinyin) })
        : h('p', { class: 'muted', text: t('paste.wordNotFound', { word }) }),
      vm.english.length
        ? h('ul', { class: 'paste-panel-defs' }, ...vm.english.map(d => h('li', { text: d })))
        : null,
      h('div', { class: 'paste-panel-actions' }, reviewBtn, playBtn),
    );
  }

  // Cleanup
  return () => {
    // Nothing persistent to clean up
  };
}