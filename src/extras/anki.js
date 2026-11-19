/**
 * Anki screen — #/extras/anki. Export the review deck as an Anki text file,
 * import one back (preview + confirm, no duplicates by hanzi), and a 4-step
 * beginner note. Logic lives in src/anki.js; this file is UI only.
 *
 * Contract: `titleKey` + `render(container, ctx)`. Every string via t('anki.*')
 * from src/locales/en.d/anki.json (es in es.d/anki.json).
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import {
  loadCards,
  sourcesOf,
  exportCards,
  exportFilename,
  parseAnkiTsv,
  previewImport,
  importCards,
} from '../anki.js';

export const titleKey = 'anki.title';

const STYLE_ID = 'anki-style';
const CSS = `
.anki-filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.5rem 0; }
.anki-filter-row select { min-height: 44px; padding: 0 0.5rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font: inherit; }
.anki-count, .anki-hint { margin: 0.25rem 0; font-size: 0.875rem; color: var(--ink-soft); }
.anki-preview { margin-top: 0.75rem; padding: 0.75rem; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.anki-preview p { margin: 0 0 0.5rem; }
.anki-status { min-height: 1.25rem; margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--ink-soft); }
.anki-status.error { color: var(--danger); }
.anki-help ol { margin: 0; padding-left: 1.25rem; line-height: 1.6; }
.anki-help li { margin-bottom: 0.5rem; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Browser download of a text file via Blob (no library). */
function downloadFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function render(container) {
  ensureStyles(document);
  reset(container);

  const sourceSelect = h('select', { class: 'anki-source', 'aria-label': t('anki.export.filter') });
  const countEl = h('p', { class: 'anki-count' });
  const exportBtn = h('button', {
    type: 'button',
    class: 'btn primary anki-export',
    text: t('anki.export.button'),
    onclick: doExport,
  });
  const statusEl = h('p', { class: 'anki-status', role: 'status', 'aria-live': 'polite' });
  const previewEl = h('div', { class: 'anki-preview-area' });

  const fileInput = h('input', {
    type: 'file',
    class: 'anki-file',
    accept: '.txt,.tsv,text/plain,text/tab-separated-values',
    hidden: true,
    onchange: (event) => onFile(event.target.files?.[0]),
  });

  let parsed = null;

  function setStatus(kind, message) {
    statusEl.className = kind ? `anki-status ${kind}` : 'anki-status';
    statusEl.textContent = message ?? '';
  }

  function clearImport() {
    parsed = null;
    fileInput.value = '';
    previewEl.replaceChildren();
  }

  async function refresh() {
    const cards = await loadCards();
    const current = sourceSelect.value;
    sourceSelect.replaceChildren(
      h('option', { value: '', text: t('anki.export.all') }),
      ...sourcesOf(cards).map((source) => h('option', { value: source, text: source })),
    );
    sourceSelect.value = sourcesOf(cards).includes(current) ? current : '';
    const shown = sourceSelect.value ? cards.filter((c) => (c.source || 'unknown') === sourceSelect.value) : cards;
    countEl.textContent = t('anki.export.count', { count: shown.length });
  }

  async function doExport() {
    exportBtn.disabled = true;
    setStatus(null);
    try {
      const cards = await loadCards(undefined, { source: sourceSelect.value || undefined });
      if (cards.length === 0) {
        setStatus('error', t('anki.export.empty'));
        return;
      }
      downloadFile(exportCards(cards), exportFilename());
      setStatus(null, t('anki.export.done', { count: cards.length }));
    } catch (err) {
      console.error('anki: export failed', err);
      setStatus('error', t('anki.export.error'));
    } finally {
      exportBtn.disabled = false;
    }
  }

  async function onFile(file) {
    clearImport();
    setStatus(null);
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      setStatus('error', t('anki.import.error.read'));
      return;
    }

    const result = parseAnkiTsv(text);
    if (result.entries.length === 0) {
      setStatus('error', t('anki.import.error.none'));
      return;
    }
    parsed = result.entries;
    const counts = await previewImport(parsed);

    const confirmBtn = h('button', {
      type: 'button',
      class: 'btn primary anki-confirm',
      text: t('anki.import.confirm', { count: counts.new }),
      disabled: counts.new === 0,
      onclick: applyImport,
    });
    previewEl.replaceChildren(
      h(
        'div',
        { class: 'anki-preview' },
        h('p', { text: t('anki.import.preview', { total: parsed.length, new: counts.new, existing: counts.existing }) }),
        result.errors.length
          ? h('p', { class: 'anki-hint', text: t('anki.import.skipped', { count: result.errors.length }) })
          : null,
        h('div', { class: 'btn-row' },
          confirmBtn,
          h('button', { type: 'button', class: 'btn secondary', text: t('anki.import.cancel'), onclick: () => { clearImport(); setStatus(null); } }),
        ),
      ),
    );
  }

  async function applyImport() {
    if (!parsed) return;
    const entries = parsed;
    clearImport();
    try {
      const result = await importCards(entries);
      setStatus(null, t('anki.import.done', result));
    } catch (err) {
      console.error('anki: import failed', err);
      setStatus('error', t('anki.import.error.apply'));
    }
    await refresh();
  }

  sourceSelect.addEventListener('change', refresh);

  container.append(
    h(
      'section',
      { class: 'card anki-export-section' },
      h('h2', { text: t('anki.export.title') }),
      h('p', { class: 'anki-hint', text: t('anki.export.notice') }),
      h('div', { class: 'anki-filter-row' }, h('span', { text: t('anki.export.filter') }), sourceSelect),
      countEl,
      h('div', { class: 'btn-row' }, exportBtn),
    ),
    h(
      'section',
      { class: 'card anki-import-section' },
      h('h2', { text: t('anki.import.title') }),
      h('p', { class: 'anki-hint', text: t('anki.import.notice') }),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn secondary', text: t('anki.import.button'), onclick: () => fileInput.click() }),
        fileInput,
      ),
      previewEl,
    ),
    statusEl,
    h(
      'section',
      { class: 'card anki-help' },
      h('h2', { text: t('anki.help.title') }),
      h(
        'ol',
        null,
        h('li', { text: t('anki.help.step1') }),
        h('li', { text: t('anki.help.step2') }),
        h('li', { text: t('anki.help.step3') }),
        h('li', { text: t('anki.help.step4') }),
      ),
    ),
  );

  refresh().catch((err) => console.error('anki: list failed', err));
  container.focus({ preventScroll: true });
}
