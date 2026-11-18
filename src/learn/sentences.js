/**
 * Everyday phrases (Tatoeba) — paginated, filterable, with audio & "add to review".
 * Contract: exports titleKey + render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { speak, isTtsAvailable } from '../audio.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';

const BASE = typeof document === 'undefined' ? '/data/sentences' : new URL('data/sentences', document.baseURI);
const SHARD_SIZE = 50; // items per page (client-side pagination after load)

let allSentences = [];
let filtered = [];
let currentPage = 0;
let currentFilter = '';
let cleanupFns = [];

async function loadSentences() {
  if (allSentences.length) return allSentences;
  const idx = await fetch(`${BASE}/index.json`).then(r => r.json());
  const shards = await Promise.all(
    idx.shards.map(s => fetch(`${BASE}/${s.file}`).then(r => r.json()))
  );
  allSentences = shards.flat();
  filtered = [...allSentences];
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
      h('a', { href: 'CREDITS.md', target: '_blank', rel: 'noopener', text: t('sentences.viewCredits') })
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

  await loadSentences();
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