/**
 * Everyday phrases (Tatoeba) — paginated, filterable, with audio & "add to review".
 * Contract: exports titleKey + render(container, ctx)
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import { speak, isTtsAvailable } from '../audio.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { fetchData } from '../data-url.js';

const SHARD_SIZE = 50; // items per page (client-side pagination after load)

const STYLE_ID = 'sentences-layout-style';

/**
 * Layout-only CSS: stack hanzi / pinyin / english so nothing is glued on one
 * line on mobile. Reuses the shell variables (light/dark + font scale).
 */
const CSS = `
.sentence-card { display: flex; flex-direction: column; gap: 0.35rem; }
.sentence-row { display: flex; flex-direction: column; gap: 0.15rem; }
.sentence-hanzi { font-size: 1.25em; line-height: 1.5; }
.sentence-en { color: var(--ink-soft); margin-top: 0.25em; line-height: 1.4; }
.sentence-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25em; }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

let allSentences = [];
let filtered = [];
let currentPage = 0;
let currentFilter = '';
let cleanupFns = [];
let loadedLocale = null;

async function loadSentences() {
  const locale = getLocale();
  if (allSentences.length && loadedLocale === locale) return allSentences;
  // Language-aware: locale 'es' reads data/es/sentences/... when translated.
  const idx = await fetchData('sentences/index.json');
  const shards = await Promise.all(idx.shards.map((s) => fetchData(`sentences/${s.file}`)));
  allSentences = shards.flat();
  filtered = [...allSentences];
  loadedLocale = locale;
  return allSentences;
}

function filterSentences(query) {
  currentFilter = query.trim().toLowerCase();
  currentPage = 0;
  if (!currentFilter) {
    filtered = [...allSentences];
  } else {
    filtered = allSentences.filter(s =>
      s.zh.includes(currentFilter) ||
      s.pinyin.toLowerCase().includes(currentFilter) ||
      s.en.toLowerCase().includes(currentFilter)
    );
  }
}

function getPage(page) {
  const start = page * SHARD_SIZE;
  return filtered.slice(start, start + SHARD_SIZE);
}

function totalPages() {
  return Math.max(1, Math.ceil(filtered.length / SHARD_SIZE));
}

function renderSentence(s, container) {
  const card = h('div', { class: 'sentence-card card' },
    h('div', { class: 'sentence-row' },
      h('span', { class: 'sentence-hanzi', text: s.zh }),
      h('span', { class: 'sentence-pinyin', html: pinyinHtml(s.pinyin) }),
    ),
    h('div', { class: 'sentence-en', text: s.en }),
    h('div', { class: 'sentence-actions' },
      h('button', {
        type: 'button',
        class: 'btn-audio field',
        'aria-label': t('sentences.playAudio'),
        onclick: async () => {
          const result = await speak(s.zh, { lang: 'zh-CN' });
          if (!result.ok) {
            alert(t('sentences.audioUnsupported'));
          }
        },
      }, t('sentences.playAudio')),
      h('button', {
        type: 'button',
        class: 'btn-review field',
        'aria-label': t('sentences.addToReview'),
        onclick: async () => {
          const result = await addToReview({
            id: s.id,
            hanzi: s.zh,
            pinyin: s.pinyin,
            english: s.en,
            source: 'sentences',
          });
          alert(result.created ? t('sentences.addedToReview') : t('sentences.alreadyInReview'));
        },
      }, t('sentences.addToReview')),
    )
  );
  container.append(card);
}

function renderPagination(container) {
  const pages = totalPages();
  if (pages <= 1) return;

  const prev = h('button', {
    type: 'button',
    class: 'field',
    disabled: currentPage === 0,
    onclick: () => { currentPage--; renderList(); },
  }, t('sentences.prev'));

  const info = h('span', { class: 'page-info', text: t('sentences.pageInfo', { page: currentPage + 1, totalPages: pages, total: filtered.length }) });

  const next = h('button', {
    type: 'button',
    class: 'field',
    disabled: currentPage >= pages - 1,
    onclick: () => { currentPage++; renderList(); },
  }, t('sentences.next'));

  container.append(h('div', { class: 'pagination' }, prev, info, next));
}

function renderAttribution(container) {
  container.append(
    h('div', { class: 'attribution' },
      h('span', { text: t('sentences.attribution') }),
      h('a', { href: 'CREDITS.md', target: '_blank', rel: 'noopener', class: 'btn sm', text: t('sentences.viewCredits') })
    )
  );
}

function renderList() {
  const list = document.getElementById('sentences-list');
  const pagination = document.getElementById('sentences-pagination');
  if (!list || !pagination) return;

  reset(list);
  reset(pagination);

  if (filtered.length === 0) {
    list.append(h('p', { class: 'empty', text: t('sentences.noResults') }));
  } else {
    const pageItems = getPage(currentPage);
    pageItems.forEach(s => renderSentence(s, list));
  }
  renderPagination(pagination);
}

async function renderRandom() {
  const list = document.getElementById('sentences-list');
  const pagination = document.getElementById('sentences-pagination');
  if (!list || !pagination) return;

  reset(list);
  reset(pagination);

  if (!allSentences.length) await loadSentences();
  const s = allSentences[Math.floor(Math.random() * allSentences.length)];
  renderSentence(s, list);
}

function bindFilter(input) {
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filterSentences(input.value);
      renderList();
    }, 150);
  });
}

export const titleKey = 'sentences.title';

export async function render(container, ctx) {
  // sub-route: #/learn/sentences or #/learn/sentences/random
  const sub = ctx?.route?.segments?.[1];

  // cleanup previous
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];

  ensureStyles();

  // Offline on a cold visit: say so instead of leaving a blank screen with an
  // uncaught "Failed to fetch" (REVIEW-3 I9).
  try {
    await loadSentences();
  } catch (err) {
    console.error('sentences load', err);
    reset(container).append(h('p', { class: 'error', text: t('common.offline') }));
    return () => {};
  }
  filtered = [...allSentences];
  currentPage = 0;

  reset(container);

  const header = h('header', { class: 'sentences-header' },
    h('h2', { text: t(titleKey) }),
    h('input', {
      type: 'search',
      id: 'sentences-filter',
      class: 'field',
      placeholder: t('sentences.filterPlaceholder'),
      'aria-label': t('sentences.filterPlaceholder'),
    }),
    h('button', {
      type: 'button',
      id: 'sentences-random',
      class: 'field',
      onclick: renderRandom,
    }, t('sentences.random'))
  );
  container.append(header);

  container.append(h('div', { id: 'sentences-list', class: 'sentences-list' }));
  container.append(h('div', { id: 'sentences-pagination', class: 'sentences-pagination' }));
  renderAttribution(container);

  const filterInput = document.getElementById('sentences-filter');
  if (filterInput) bindFilter(filterInput);

  if (sub === 'random') {
    await renderRandom();
  } else {
    renderList();
  }

  container.focus({ preventScroll: true });

  return () => {
    cleanupFns.forEach(fn => fn());
  };
}