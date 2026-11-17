/**
 * Backup & Restore screen — export all app data to a .json file, import one back.
 * Route: #/extras/backup (opened directly by the extras hub).
 *
 * Contract: `titleKey` + `render(container, ctx)`; every string comes from t()
 * with a backupScreen.* key (src/locales/en.d/backup.json).
 *
 * Testability hooks on the container:
 *   container.dataset.state   'idle' | 'preview' | 'importing'
 *   .backup-export            the Download button
 *   .backup-import-file       the hidden <input type=file>
 *   .backup-confirm-btn       the button that actually applies the import
 *   .backup-preview-stats     the preview line (cards / streak / lessons)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { exportAll, importAll, validate } from '../backup.js';

export const titleKey = 'backupScreen.title';

const STYLE_ID = 'backup-style';
const CSS = `
.backup-section { margin-bottom: 1.25rem; }
.backup-notice { margin: 0 0 1rem; padding: 0.75rem; background: var(--bg-elevated); border: 1px solid var(--line); border-radius: var(--radius); font-size: 0.9rem; color: var(--fg-soft); }
.backup-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
.backup-modes { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.9rem; }
.backup-modes label { display: inline-flex; align-items: center; gap: 0.35rem; }
.backup-preview { margin-top: 1rem; padding: 0.75rem; background: var(--bg-soft); border: 1px solid var(--line); border-radius: var(--radius); }
.backup-preview-title { margin: 0 0 0.5rem; font-weight: 600; }
.backup-preview-stats { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; color: var(--fg-soft); }
.backup-confirm { margin-top: 1rem; padding: 0.75rem; border: 1px solid var(--line); border-radius: var(--radius); }
.backup-confirm-title { margin: 0 0 0.5rem; font-weight: 600; }
.backup-confirm-text { margin: 0 0 0.5rem; font-size: 0.9rem; color: var(--fg-soft); }
.backup-confirm-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.backup-status { margin-top: 0.75rem; padding: 0.6rem; border-radius: var(--radius); font-size: 0.9rem; }
.backup-status.success { border: 1px solid var(--line); background: var(--bg-elevated); }
.backup-status.error { border: 1px solid var(--danger, #b00); }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Local date as YYYY-MM-DD, for the download file name. */
export function dateStamp(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Short summary of a validated export, for the preview line. */
export function describeExport(data) {
  const state = data?.stores?.gamification?.state ?? {};
  return {
    cards: Object.keys(data?.stores?.srs ?? {}).length,
    streak: state.streak ?? 0,
    lessons: state.events?.lesson_done ?? 0,
    points: state.points ?? 0,
  };
}

export function render(container, ctx) {
  ensureStyles(document);

  const state = { file: null, data: null, mode: 'replace' };

  const setState = (name) => {
    container.dataset.state = name;
  };

  // --- Download ---
  const exportBtn = h('button', {
    type: 'button',
    class: 'field backup-export',
    text: t('backupScreen.export.button'),
    onclick: handleExport,
  });
  const exportSection = h(
    'section',
    { class: 'backup-section card' },
    h('h2', { text: t('backupScreen.export.title') }),
    h('p', { class: 'backup-notice', text: t('backupScreen.dataNotice') }),
    h('div', { class: 'backup-actions' }, exportBtn),
  );

  // --- Import ---
  const fileInput = h('input', {
    type: 'file',
    class: 'backup-import-file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: (event) => {
      const file = event.target.files?.[0];
      if (file) readFile(file);
    },
  });
  const modeRadio = (value, labelKey) =>
    h(
      'label',
      {},
      h('input', {
        type: 'radio',
        name: 'backup-mode',
        value,
        checked: value === state.mode,
        onchange: () => {
          state.mode = value;
          renderConfirm();
        },
      }),
      h('span', { text: t(labelKey) }),
    );
  const importSection = h(
    'section',
    { class: 'backup-section card' },
    h('h2', { text: t('backupScreen.import.title') }),
    h('p', { class: 'backup-notice', text: t('backupScreen.import.hint') }),
    h(
      'div',
      { class: 'backup-actions' },
      h('button', {
        type: 'button',
        class: 'field backup-import',
        text: t('backupScreen.import.button'),
        onclick: () => fileInput.click(),
      }),
      fileInput,
    ),
    h(
      'div',
      { class: 'backup-modes' },
      modeRadio('replace', 'backupScreen.mode.replace'),
      modeRadio('merge', 'backupScreen.mode.merge'),
    ),
  );

  const previewArea = h('div', { class: 'backup-preview-area' });
  const confirmArea = h('div', { class: 'backup-confirm-area' });
  const statusArea = h('div', { class: 'backup-status-area', role: 'status', 'aria-live': 'polite' });

  reset(container).append(
    h(
      'main',
      { class: 'screen' },
      h('header', { class: 'app-header', text: t(titleKey) }),
      exportSection,
      importSection,
      previewArea,
      confirmArea,
      statusArea,
    ),
  );
  setState('idle');
  container.focus({ preventScroll: true });

  function setStatus(kind, message) {
    statusArea.replaceChildren(kind ? h('p', { class: `backup-status ${kind}`, text: message }) : []);
  }

  async function handleExport() {
    exportBtn.disabled = true;
    setStatus(null);
    try {
      const data = await exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = h('a', {
        href: url,
        download: t('backupScreen.export.filename', { date: dateStamp(data.exportedAt) }),
      });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const { cards, streak } = describeExport(data);
      setStatus('success', t('backupScreen.export.success', { count: cards, streak }));
    } catch (err) {
      console.error('backup: export failed', err);
      setStatus('error', t('backupScreen.export.error'));
    } finally {
      exportBtn.disabled = false;
    }
  }

  async function readFile(file) {
    setStatus(null);
    previewArea.replaceChildren();
    confirmArea.replaceChildren();
    setState('idle');

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setStatus('error', t('backupScreen.import.error.corrupt'));
      return;
    }

    const check = validate(data);
    if (!check.ok) {
      setStatus('error', t(`backupScreen.import.error.${check.error.split('.')[1]}`));
      return;
    }

    state.file = file;
    state.data = data;
    renderPreview();
  }

  function renderPreview() {
    const summary = describeExport(state.data);
    previewArea.replaceChildren(
      h(
        'div',
        { class: 'backup-preview' },
        h('h3', { class: 'backup-preview-title', text: t('backupScreen.import.preview.title') }),
        h(
          'div',
          { class: 'backup-preview-stats' },
          h('span', { text: t('backupScreen.import.preview.cards', { count: summary.cards }) }),
          h('span', { text: t('backupScreen.import.preview.streak', { streak: summary.streak }) }),
          h('span', { text: t('backupScreen.import.preview.lessons', { lessons: summary.lessons }) }),
        ),
        h('p', { class: 'backup-preview-stats', text: t('backupScreen.import.preview.points', { points: summary.points }) }),
      ),
    );
    renderConfirm();
    setState('preview');
  }

  function renderConfirm() {
    if (!state.data) return;
    const replace = state.mode === 'replace';
    confirmArea.replaceChildren(
      h(
        'div',
        { class: 'backup-confirm' },
        h('h3', { class: 'backup-confirm-title', text: t('backupScreen.import.confirm.title') }),
        h('p', {
          class: 'backup-confirm-text',
          text: t(replace ? 'backupScreen.import.confirm.replace' : 'backupScreen.import.confirm.merge'),
        }),
        h(
          'div',
          { class: 'backup-confirm-actions' },
          h('button', {
            type: 'button',
            class: 'field backup-confirm-btn',
            text: t(replace ? 'backupScreen.import.confirm.button' : 'backupScreen.import.confirm.buttonMerge'),
            onclick: applyImport,
          }),
          h('button', {
            type: 'button',
            class: 'field backup-cancel-btn',
            text: t('backupScreen.import.cancel'),
            onclick: () => {
              state.data = null;
              state.file = null;
              fileInput.value = '';
              previewArea.replaceChildren();
              confirmArea.replaceChildren();
              setStatus(null);
              setState('idle');
            },
          }),
        ),
      ),
    );
  }

  async function applyImport() {
    if (!state.data) return;
    setState('importing');
    setStatus(null);
    try {
      const result = await importAll(state.data, { mode: state.mode });
      setStatus(
        'success',
        t('backupScreen.import.success', { imported: result.imported, skipped: result.skipped }),
      );
      state.data = null;
      state.file = null;
      fileInput.value = '';
      previewArea.replaceChildren();
      confirmArea.replaceChildren();
      setState('idle');
      if (ctx?.onImported) ctx.onImported(result);
    } catch (err) {
      console.error('backup: import failed', err);
      setStatus('error', t('backupScreen.import.error.applyFailed'));
      renderConfirm();
      setState('preview');
    }
  }
}
