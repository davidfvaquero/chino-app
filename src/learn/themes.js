/**
 * themes.js — vocabulary/phrase themes (food, travel, hotel, ...).
 *
 * Screen: `#/learn/themes` list, `#/learn/themes/<id>` one theme.
 * A theme shows words and phrases (hanzi, tone-coloured pinyin, English),
 * TTS per row, per-row "add to review", "add whole theme", and
 * "Mark as studied" which fires 'chino:lesson_done'.
 *
 * Data: public/data/themes/index.json + theme-NN.json (docs/themes-schema.md).
 *
 * Public API:
 *   titleKey                              // i18n key for the hub menu label
 *   DATA_BASE                             // URL of public/data/themes/
 *   loadIndex({base, fetchJson})          -> [{id, title, icon?, travel?}]
 *   loadTheme(id, {base, fetchJson})      -> theme object (validated)
 *   validateIndex(index)                  -> string[] problems
 *   validateTheme(theme)                  -> string[] problems
 *   themeCards(theme)                     -> review entries for words+phrases
 *   addThemeToReview(theme, {add})        -> {added, total}
 *   studiedKey(id) / getStudied(id) / markStudied(id)
 *   render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { speak } from '../audio.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'themes.title';
export const PROGRESS_STORE = 'progress';
export const DATA_BASE = new URL('../../data/themes/', import.meta.url);

/**
 * Reads one theme file, language-aware by default: locale 'es' loads
 * `data/es/themes/<relPath>` when translated, else English. An injected
 * `fetchJson`/`base` keeps the plain-URL contract (tests).
 */
const readJson = (relPath, { base = DATA_BASE, fetchJson } = {}) =>
  fetchJson ? fetchJson(new URL(relPath, base)) : fetchData(`themes/${relPath}`);

const str = (v) => typeof v === 'string' && v.trim() !== '';

/** Problems with one theme object (empty array = valid). */
export function validateTheme(theme) {
  const problems = [];
  if (!theme || typeof theme !== 'object') return ['theme is not an object'];
  if (!str(theme.id)) problems.push('theme.id missing');
  if (!str(theme.title) && !str(theme.titleKey)) problems.push('theme.title or theme.titleKey missing');
  for (const list of ['words', 'phrases']) {
    if (!Array.isArray(theme[list])) {
      problems.push(`${list} is not an array`);
      continue;
    }
    theme[list].forEach((entry, i) => {
      if (!str(entry?.hanzi)) problems.push(`${list}[${i}].hanzi missing`);
      if (!str(entry?.pinyin)) problems.push(`${list}[${i}].pinyin missing`);
      if (!str(entry?.english)) problems.push(`${list}[${i}].english missing`);
    });
  }
  return problems;
}

/** Problems with the theme index (empty array = valid). */
export function validateIndex(index) {
  const list = Array.isArray(index) ? index : index?.themes;
  if (!Array.isArray(list)) return ['index is not an array'];
  const problems = [];
  const seen = new Set();
  list.forEach((item, i) => {
    if (!str(item?.id)) problems.push(`index[${i}].id missing`);
    else if (seen.has(item.id)) problems.push(`index[${i}] duplicate id ${item.id}`);
    else seen.add(item.id);
    if (!str(item?.title) && !str(item?.titleKey)) problems.push(`index[${i}].title missing`);
  });
  return problems;
}

/** Loads the index (bare array in the JSON file). */
export async function loadIndex(opts = {}) {
  const index = await readJson('index.json', opts);
  const problems = validateIndex(index);
  if (problems.length) throw new Error(`themes index: ${problems.join('; ')}`);
  return Array.isArray(index) ? index : index.themes;
}

/** Loads and validates one theme; throws on a schema problem. */
export async function loadTheme(id, opts = {}) {
  const theme = await readJson(`${id}.json`, opts);
  const problems = validateTheme(theme);
  if (problems.length) throw new Error(`themes ${id}: ${problems.join('; ')}`);
  return {
    ...theme,
    id: theme.id || id,
    words: theme.words ?? [],
    phrases: theme.phrases ?? [],
  };
}

/** Review entries for every word and phrase of a theme (deduped by hanzi). */
export function themeCards(theme) {
  const seen = new Set();
  const out = [];
  for (const kind of ['words', 'phrases']) {
    for (const entry of theme?.[kind] ?? []) {
      if (!entry?.hanzi || seen.has(entry.hanzi)) continue;
      seen.add(entry.hanzi);
      out.push({
        id: `theme:${entry.hanzi}`,
        hanzi: entry.hanzi,
        pinyin: entry.pinyin,
        english: entry.english,
        source: 'theme',
        themeId: theme.id,
        kind,
      });
    }
  }
  return out;
}

/** Adds every card of a theme to the review deck. Idempotent (srs.addToReview). */
export async function addThemeToReview(theme, { add = addToReview } = {}) {
  const cards = themeCards(theme);
  let added = 0;
  for (const card of cards) {
    const res = await add(card);
    if (res?.created) added += 1;
  }
  return { added, total: cards.length };
}

/* ------------------------------------------------------------- progress -- */

export function studiedKey(id) {
  return `theme:${id}`;
}

export async function getStudied(id, { store = storage } = {}) {
  return (await store.get(PROGRESS_STORE, studiedKey(id))) ?? null;
}

export async function markStudied(theme, { store = storage, now = Date.now() } = {}) {
  const record = {
    themeId: theme.id,
    words: (theme.words ?? []).length,
    phrases: (theme.phrases ?? []).length,
    studiedAt: now,
  };
  await store.set(PROGRESS_STORE, studiedKey(theme.id), { ...(await getStudied(theme.id, { store })), ...record });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('chino:lesson_done', {
        detail: { area: 'themes', themeId: theme.id, words: record.words, phrases: record.phrases },
      }),
    );
  }
  return record;
}

/* ----------------------------------------------------------------- style -- */

const STYLE_ID = 'themes-style';
const CSS = `
.themes-list { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); }
.theme-tile { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; padding: 0.85rem; text-align: left; }
.theme-tile .theme-icon { font-size: 1.5rem; line-height: 1; }
.theme-tile .theme-name { font-weight: 600; }
.theme-badge { margin-left: auto; font-size: 0.72rem; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.45rem; }
.theme-head { display: flex; flex-direction: column; gap: 0.5rem; }
.theme-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.theme-counts { color: var(--ink-soft); font-size: 0.85rem; }
.theme-subhead { margin: 1.1rem 0 0.4rem; font-size: 0.95rem; color: var(--ink-soft); letter-spacing: 0.04em; }
.theme-rows { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.theme-row { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.7rem 0.8rem; }
.theme-row .theme-hanzi { font-size: 1.35rem; }
.theme-row .theme-meaning { color: var(--ink-soft); font-size: 0.95rem; }
.theme-row-btns { display: flex; gap: 0.4rem; margin-top: 0.25rem; }
.theme-row-btns .btn { padding: 0.35rem 0.7rem; font-size: 0.85rem; }
.theme-note { color: var(--ink-soft); font-size: 0.85rem; }
@media (min-width: 40rem) { .theme-list-wrap { max-width: 42rem; } }
`;

function ensureStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/* ---------------------------------------------------------------- render -- */

export async function render(container, ctx) {
  ensureStyles();
  const themeId = ctx?.route?.segments?.[1];
  if (themeId) return renderTheme(container, ctx, themeId);
  return renderList(container, ctx);
}

const titleOf = (item) => (item.titleKey ? t(item.titleKey) : item.title);

function backButton(ctx) {
  return h('button', {
    type: 'button',
    class: 'btn',
    text: t('themes.back'),
    onclick: () => ctx.navigate('learn/themes'),
  });
}

async function renderList(container, ctx) {
  reset(container);
  const wrap = h('div', { class: 'theme-list-wrap' }, h('p', { class: 'theme-note', text: t('themes.listIntro') }));
  container.append(wrap);
  try {
    const index = await loadIndex();
    const list = h('div', { class: 'themes-list' });
    for (const item of index) {
      list.append(
        h(
          'button',
          {
            type: 'button',
            class: 'card theme-tile',
            'data-theme': item.id,
            onclick: () => ctx.navigate(`learn/themes/${item.id}`),
          },
          h('span', { class: 'theme-icon', text: item.icon ?? '📚' }),
          h('span', { class: 'theme-name', text: titleOf(item) }),
          item.travel ? h('span', { class: 'theme-badge', text: t('themes.travel') }) : null,
        ),
      );
    }
    wrap.append(list);
  } catch (err) {
    console.error(err);
    wrap.append(h('p', { class: 'theme-note', text: t('themes.loadError') }));
  }
  container.focus?.({ preventScroll: true });
}

async function renderTheme(container, ctx, id) {
  reset(container);
  let theme;
  try {
    theme = await loadTheme(id);
  } catch (err) {
    console.warn(err);
    container.append(
      h(
        'section',
        { class: 'card' },
        h('h2', { text: t('themes.soonTitle') }),
        h('p', { class: 'theme-note', text: t('themes.soon') }),
        backButton(ctx),
      ),
    );
    return;
  }

  const studied = await getStudied(theme.id);
  const words = theme.words ?? [];
  const phrases = theme.phrases ?? [];
  const status = h('p', { class: 'theme-note' });

  const addAll = h('button', {
    type: 'button',
    class: 'btn primary',
    text: t('themes.addAll'),
    onclick: async () => {
      addAll.disabled = true;
      const { added, total } = await addThemeToReview(theme);
      status.textContent = t('themes.addedAll', { added, total });
      addAll.disabled = false;
    },
  });

  const study = h('button', {
    type: 'button',
    class: 'btn',
    text: studied ? t('themes.studied') : t('themes.markStudied'),
    disabled: Boolean(studied),
    onclick: async () => {
      await markStudied(theme);
      study.textContent = t('themes.studied');
      study.disabled = true;
    },
  });

  const section = h(
    'section',
    { class: 'theme-head' },
    backButton(ctx),
    h('h2', { text: titleOf(theme) }),
    h('p', { class: 'theme-counts', text: t('themes.counts', { words: words.length, phrases: phrases.length }) }),
    h('div', { class: 'theme-actions' }, addAll, study),
    status,
  );

  section.append(h('h3', { class: 'theme-subhead', text: t('themes.words') }));
  section.append(rowList(theme, 'words', words));
  section.append(h('h3', { class: 'theme-subhead', text: t('themes.phrases') }));
  section.append(rowList(theme, 'phrases', phrases));

  container.append(section);
  container.focus?.({ preventScroll: true });
}

function rowList(theme, kind, entries) {
  const list = h('ul', { class: 'theme-rows' });
  for (const entry of entries) {
    const row = h(
      'li',
      { class: 'card theme-row' },
      h('span', { class: 'theme-hanzi', lang: 'zh-CN', text: entry.hanzi }),
      h('span', { class: 'pinyin', html: pinyinHtml(entry.pinyin) }),
      h('span', { class: 'theme-meaning', text: entry.english }),
    );
    const note = h('span', { class: 'theme-note' });
    const btns = h(
      'div',
      { class: 'theme-row-btns' },
      h('button', {
        type: 'button',
        class: 'btn',
        'aria-label': t('themes.play'),
        text: '🔊',
        onclick: () => speak(entry.hanzi, { lang: 'zh-CN' }),
      }),
      h('button', {
        type: 'button',
        class: 'btn',
        text: t('themes.addOne'),
        onclick: async (event) => {
          const btn = event.currentTarget;
          btn.disabled = true;
          await addToReview({ hanzi: entry.hanzi, pinyin: entry.pinyin, english: entry.english, source: 'theme', themeId: theme.id, kind });
          note.textContent = t('themes.addedOne');
        },
      }),
    );
    row.append(btns, note);
    list.append(row);
  }
  return list;
}