/**
 * Worksheet — printable calligraphy practice sheet.
 * Route: `#/extras/worksheet`
 *
 * User pastes/types characters (or picks "last review" / "lesson words"),
 * the app generates a printable sheet: per character a row with
 * (a) large character with numbered stroke order,
 * (b) 田字格 grid cells — faint gray model repeated + empty cells for writing.
 *
 * Options: cell size (small/medium/large), rows per character (3–10),
 * show pinyin & meaning. Primary button "Download PDF" renders each sheet page
 * to a <canvas> (~150 dpi 田字格 grid, gray guide hanzi, pinyin/meaning when on)
 * and packs the JPEGs into a real .pdf with src/pdf.js (no npm/CDN deps). On
 * mobile the file is shared via navigator.share when available, otherwise
 * downloaded as an <a download>. The old window.print() path is kept as a
 * secondary button (its print stylesheet is A4 portrait, no menus).
 *
 * Reuses stroke loader/renderer from src/learn/strokes.js and
 * src/learn/strokes-sheet.js (import only, no edits). Max 20 characters.
 * Zero external dependencies.
 *
 * Pure, browser-free helpers (covered by tests/worksheet.test.mjs):
 *   parseCharacters(text, {max})      -> {characters, total, overflow}
 *   buildGrid(rows, cols)             -> {rows, cols, cells: [{r,c},...]}
 *   calculateLayout(chars, options)   -> {characters, cellsPerRow, totalRows}
 *
 * Screen contract: `titleKey` + `render(container, ctx)` (returns cleanup).
 * `container.worksheetApi.state()` exposes the generated cards for headless checks.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { loadStrokes } from '../learn/strokes.js';
import { lookup } from '../dictionary.js';
import { getDueCards } from '../srs.js';
import { loadIndex } from '../learn/lessons.js';
import { getSettings } from '../settings.js';
import { buildPdf } from '../pdf.js';
import storage from '../storage.js';
import { localDayKey } from '../day.js';
import {
  clampCopies,
  MAX_COPIES,
  MIN_COPIES,
  DEFAULT_COPIES,
  planWorksheet,
  renderWorksheetPages,
} from './worksheet-rows.js';
import { renderCardsPages } from './worksheet-cards.js';

export const titleKey = 'worksheet.title';
export const MAX_CHARACTERS = 20;
/** Sheet styles: 'rows' = one row per character with stroke-order steps (default). */
export const STYLES = ['rows', 'cards'];
const PREF = { style: 'worksheetStyle', copies: 'worksheetCopies', steps: 'worksheetSteps' };
const STYLE_ID = 'worksheet-style';
const HANZI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;

/* ------------------------------------------------------------ cell sizes -- */

export const CELL_SIZES = {
  small: { size: 32, labelKey: 'worksheet.cellSize.small' },
  medium: { size: 42, labelKey: 'worksheet.cellSize.medium' },
  large: { size: 56, labelKey: 'worksheet.cellSize.large' },
};

/* ---------------------------------------------------------- pure logic ---- */

/**
 * Hanzi of `text`, in order, capped at `max`; `overflow` when more were typed.
 * Re-uses the same logic as strokes-sheet.parseCharacters.
 */
export function parseCharacters(text, { max = MAX_CHARACTERS } = {}) {
  const all = String(text ?? '').match(HANZI_RE) || [];
  const limit = Math.max(0, Number(max) || 0);
  return { characters: all.slice(0, limit), total: all.length, overflow: all.length > limit };
}

/**
 * Build a 田字格 grid descriptor.
 * @param {number} rows - rows per character (3–10)
 * @param {number} cols - columns per row (fixed at 2: model + empty)
 * @returns {{rows, cols, cells: Array<{r:number,c:number}>}}
 */
export function buildGrid(rows, cols = 2) {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(cols));
  const cells = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      cells.push({ r: row, c: col });
    }
  }
  return { rows: r, cols: c, cells };
}

/**
 * Calculate layout for the worksheet.
 * @param {string[]} characters - array of hanzi
 * @param {{rowsPerChar: number, showPinyin: boolean, showMeaning: boolean}} options
 * @returns {{characters: string[], cellsPerRow: number, totalRows: number, perChar: Array<{char:string, rows:number}>}}
 */
export function calculateLayout(characters, options = {}) {
  const rowsPerChar = Math.min(10, Math.max(3, Math.floor(options.rowsPerChar) || 3));
  const perChar = characters.map((char) => ({ char, rows: rowsPerChar }));
  const totalRows = perChar.reduce((sum, pc) => sum + pc.rows, 0);
  return {
    characters,
    cellsPerRow: 2, // model + empty
    totalRows,
    perChar,
  };
}

/* ---------------------------------------------------- PDF (canvas->JPEG) -- */

/** Local YYYY-MM-DD stamp for the PDF filename. */
export const dateStamp = localDayKey;

/** Persisted sheet preferences (same `settings` store as the other options). */
async function loadPrefs() {
  const prefs = { style: 'rows', copies: DEFAULT_COPIES, showSteps: true };
  try {
    const style = await storage.get('settings', PREF.style);
    if (STYLES.includes(style)) prefs.style = style;
    const copies = await storage.get('settings', PREF.copies);
    if (copies !== undefined) prefs.copies = clampCopies(copies);
    const steps = await storage.get('settings', PREF.steps);
    if (typeof steps === 'boolean') prefs.showSteps = steps;
  } catch {
    /* storage unavailable — defaults are fine */
  }
  return prefs;
}

function savePref(key, value) {
  try {
    storage.set('settings', key, value).catch(() => {});
  } catch {
    /* storage unavailable — the control still works for this session */
  }
}

/** Encode canvases as JPEG page images for src/pdf.js. */
async function canvasesToJpegs(canvases, quality) {
  const out = [];
  for (const canvas of canvases) {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', quality);
    });
    out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  return out;
}

/* --------------------------------------------------------------- screen -- */

const CSS = `
.worksheet { display: flex; flex-direction: column; gap: 0.9rem; }
.worksheet [hidden] { display: none !important; }

.ws-form { display: flex; flex-direction: column; gap: 0.6rem; }
.ws-input-wrap { display: flex; flex-direction: column; gap: 0.3rem; }
.ws-input { width: 100%; min-height: 80px; padding: 0.6rem 0.7rem; font-size: 1.05rem; font-family: inherit; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: inherit; resize: vertical; }
.ws-input:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.ws-input-hint { font-size: 0.8rem; color: var(--ink-soft); }

.ws-sources { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.ws-source-btn { min-height: 44px; padding: 0.45rem 0.7rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: inherit; font-size: 0.9rem; }
.ws-source-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ws-options { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; padding: 0.5rem; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.ws-opt-group { display: flex; flex-direction: column; gap: 0.2rem; }
.ws-opt-label { font-size: 0.8rem; color: var(--ink-soft); letter-spacing: 0.02em; }
.ws-select { min-height: 44px; padding: 0.4rem 0.6rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: inherit; font: inherit; min-width: 120px; }
.ws-checkbox { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 44px; padding: 0 0.8rem; border: 1.5px solid var(--edge); border-radius: 999px; background: var(--surface); font-size: 0.9rem; }
.ws-checkbox input[type="checkbox"] { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.ws-checkbox:has(input:checked) { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
.ws-checkbox:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }

.ws-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ws-btn { min-height: 44px; padding: 0.55rem 0.9rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: inherit; font-size: 0.95rem; }
.ws-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.ws-btn.ghost { border-color: transparent; background: transparent; color: var(--accent); }
.ws-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ws-warning { margin: 0; color: var(--accent); font-size: 0.85rem; }
.ws-hint { margin: 0; min-height: 1.2em; opacity: 0.8; font-size: 0.9rem; }

.ws-sheet { display: flex; flex-direction: column; gap: 1rem; }
.ws-pages { display: flex; flex-direction: column; gap: 0.75rem; }
.ws-page { display: block; width: 100%; height: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 0.35rem; }


@media print {
  .ws-form, .ws-actions, .ws-hint, .ws-warning { display: none !important; }
  .worksheet { gap: 0.5rem; }
  .ws-sheet.ws-cards { padding: 12mm 14mm; }
  .ws-pages { gap: 0; }
  .ws-page { width: 100%; border: 0; border-radius: 0; page-break-after: always; break-after: page; }
  .ws-page:last-child { page-break-after: auto; break-after: auto; }
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; }
  .app-header, .tabbar, .screen > h2 { display: none !important; }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

export async function render(container, ctx) {
  ensureStyles(document);

  const prefs = await loadPrefs();

  // State
  let characters = '';
  let options = {
    style: prefs.style,
    copies: prefs.copies,
    showSteps: prefs.showSteps,
    cellSize: 'medium',
    rowsPerChar: 5,
    showPinyin: true,
    showMeaning: true,
  };
  let generatedCards = [];
  let lastPdfBlob = null;
  let alive = true;

  // UI skeleton
  const input = h('textarea', {
    class: 'ws-input',
    name: 'characters',
    placeholder: t('worksheet.inputPlaceholder'),
    'aria-label': t('worksheet.inputLabel'),
    value: '',
  });

  const inputWrap = h('div', { class: 'ws-input-wrap' },
    h('label', { class: 'ws-input-hint', text: t('worksheet.inputLabel') }),
    input,
  );

  const lastReviewBtn = h('button', {
    type: 'button',
    class: 'ws-source-btn',
    text: t('worksheet.lastReview'),
    onclick: onLastReview,
    disabled: true,
  });
  const lessonWordsBtn = h('button', {
    type: 'button',
    class: 'ws-source-btn',
    text: t('worksheet.lessonWords'),
    onclick: onLessonWords,
    disabled: true,
  });
  const sources = h('div', { class: 'ws-sources' }, lastReviewBtn, lessonWordsBtn);

  // Options
  const styleSelect = h('select', { class: 'ws-select', 'data-option': 'style' },
    ...STYLES.map((key) => h('option', { value: key, text: t(`worksheet.style.${key}`) })),
  );
  styleSelect.value = options.style;
  styleSelect.addEventListener('change', () => {
    options.style = styleSelect.value;
    savePref(PREF.style, options.style);
    syncOptionVisibility();
  });

  const copiesSelect = h('select', { class: 'ws-select', 'data-option': 'copies' },
    ...Array.from({ length: MAX_COPIES - MIN_COPIES + 1 }, (_, i) => i + MIN_COPIES).map((n) =>
      h('option', { value: String(n), text: String(n) })
    ),
  );
  copiesSelect.value = String(options.copies);
  copiesSelect.addEventListener('change', () => {
    options.copies = clampCopies(copiesSelect.value);
    copiesSelect.value = String(options.copies);
    savePref(PREF.copies, options.copies);
  });

  const showStepsCheckbox = h('input', { type: 'checkbox', checked: options.showSteps, 'data-option': 'steps' });
  showStepsCheckbox.addEventListener('change', () => {
    options.showSteps = showStepsCheckbox.checked;
    savePref(PREF.steps, options.showSteps);
  });

  const cellSizeSelect = h('select', { class: 'ws-select' },
    ...Object.entries(CELL_SIZES).map(([key, cfg]) =>
      h('option', { value: key, text: t(cfg.labelKey) })
    ),
  );
  cellSizeSelect.value = options.cellSize;
  cellSizeSelect.addEventListener('change', () => { options.cellSize = cellSizeSelect.value; });

  const rowsSelect = h('select', { class: 'ws-select' },
    ...Array.from({ length: 8 }, (_, i) => i + 3).map((n) =>
      h('option', { value: String(n), text: `${n} ${t('worksheet.rowsLabel')}` })
    ),
  );
  rowsSelect.value = String(options.rowsPerChar);
  rowsSelect.addEventListener('change', () => { options.rowsPerChar = Number(rowsSelect.value); });

  const showPinyinCheckbox = h('input', { type: 'checkbox', checked: options.showPinyin });
  showPinyinCheckbox.addEventListener('change', () => { options.showPinyin = showPinyinCheckbox.checked; });
  const showMeaningCheckbox = h('input', { type: 'checkbox', checked: options.showMeaning });
  showMeaningCheckbox.addEventListener('change', () => { options.showMeaning = showMeaningCheckbox.checked; });

  const cardsOnly = [
    h('div', { class: 'ws-opt-group ws-cards-only' },
      h('span', { class: 'ws-opt-label', text: t('worksheet.cellSizeLabel') }),
      cellSizeSelect,
    ),
    h('div', { class: 'ws-opt-group ws-cards-only' },
      h('span', { class: 'ws-opt-label', text: t('worksheet.rowsLabel') }),
      rowsSelect,
    ),
    h('label', { class: 'ws-checkbox ws-cards-only' }, showMeaningCheckbox, t('worksheet.showMeaning')),
  ];

  const optionsDiv = h('div', { class: 'ws-options' },
    h('div', { class: 'ws-opt-group' },
      h('span', { class: 'ws-opt-label', text: t('worksheet.styleLabel') }),
      styleSelect,
    ),
    h('div', { class: 'ws-opt-group' },
      h('span', { class: 'ws-opt-label', text: t('worksheet.copiesLabel') }),
      copiesSelect,
    ),
    h('label', { class: 'ws-checkbox' }, showStepsCheckbox, t('worksheet.showSteps')),
    ...cardsOnly,
    h('label', { class: 'ws-checkbox' }, showPinyinCheckbox, t('worksheet.showPinyin')),
  );

  function syncOptionVisibility() {
    const rows = options.style === 'rows';
    optionsDiv.querySelectorAll('.ws-cards-only').forEach((el) => { el.hidden = rows; });
    optionsDiv.querySelector('[data-option="copies"]')?.closest('.ws-opt-group')?.toggleAttribute('hidden', !rows);
    optionsDiv.querySelector('[data-option="steps"]')?.closest('.ws-checkbox')?.toggleAttribute('hidden', !rows);
  }
  syncOptionVisibility();

  const generateBtn = h('button', {
    type: 'button',
    class: 'ws-btn primary',
    text: t('worksheet.generate'),
    onclick: onGenerate,
  });
  const printBtn = h('button', {
    type: 'button',
    class: 'ws-btn ghost',
    text: t('worksheet.print'),
    onclick: () => window.print(),
    disabled: true,
  });
  const pdfBtn = h('button', {
    type: 'button',
    class: 'ws-btn',
    'data-action': 'download-pdf',
    text: t('worksheet.downloadPdf'),
    onclick: onDownloadPdf,
    disabled: true,
  });
  const actions = h('div', { class: 'ws-actions' }, generateBtn, pdfBtn, printBtn);

  const warning = h('p', { class: 'ws-warning', hidden: true });
  const hint = h('p', { class: 'ws-hint' });
  const sheetBox = h('div', { class: 'ws-sheet', hidden: true });

  const section = h('section', { class: 'worksheet' },
    h('div', { class: 'ws-form' }, inputWrap, sources, optionsDiv, actions, warning, hint),
    sheetBox,
  );

  reset(container).append(section);

  // Enable source buttons after checking data availability
  checkSources();

  async function checkSources() {
    try {
      const due = await getDueCards();
      lastReviewBtn.disabled = due.length === 0;
    } catch {
      lastReviewBtn.disabled = true;
    }
    try {
      const index = await loadIndex();
      lessonWordsBtn.disabled = !index.lessons?.length;
    } catch {
      lessonWordsBtn.disabled = true;
    }
  }

  async function onLastReview() {
    try {
      const due = await getDueCards();
      const chars = due.slice(0, MAX_CHARACTERS).map((c) => c.hanzi).join('');
      if (chars) {
        characters = chars;
        input.value = chars;
        hint.textContent = t('worksheet.loadedLastReview', { count: chars.length });
        onGenerate();
      } else {
        hint.textContent = t('worksheet.noReviewChars');
      }
    } catch (err) {
      console.error('worksheet: last review failed', err);
      hint.textContent = t('worksheet.loadError');
    }
  }

  async function onLessonWords() {
    try {
      const index = await loadIndex();
      // Take vocabulary from the first incomplete lesson, or first lesson
      let targetLesson = index.lessons?.find((l) => {
        // We can't easily check progress here without async, so just pick first
        return true;
      });
      if (!targetLesson && index.lessons?.length) targetLesson = index.lessons[0];
      if (!targetLesson) {
        hint.textContent = t('worksheet.noLessons');
        return;
      }
      const lesson = await import(`../learn/lessons.js`).then((m) => m.loadLesson(index.level, targetLesson.id));
      const chars = (lesson.vocabulary ?? []).slice(0, MAX_CHARACTERS).map((w) => w.hanzi).join('');
      if (chars) {
        characters = chars;
        input.value = chars;
        hint.textContent = t('worksheet.loadedLesson', { count: chars.length, lesson: targetLesson.id });
        onGenerate();
      } else {
        hint.textContent = t('worksheet.noLessonChars');
      }
    } catch (err) {
      console.error('worksheet: lesson words failed', err);
      hint.textContent = t('worksheet.loadError');
    }
  }

  async function onGenerate() {
    const parsed = parseCharacters(input.value);
    characters = parsed.characters.join('');
    input.value = characters;

    if (!characters) {
      hint.textContent = t('worksheet.empty');
      sheetBox.hidden = true;
      printBtn.disabled = true;
      pdfBtn.disabled = true;
      warning.hidden = true;
      return;
    }

    warning.hidden = !parsed.overflow;
    if (parsed.overflow) warning.textContent = t('worksheet.tooMany', { max: MAX_CHARACTERS });

    hint.textContent = t('worksheet.loading');
    sheetBox.hidden = true;
    printBtn.disabled = true;
    pdfBtn.disabled = true;
    sheetBox.replaceChildren();

    generatedCards = [];
    let pinyinOn = true;
    try {
      const settings = await getSettings();
      pinyinOn = settings.pinyin !== false;
    } catch {
      /* settings unavailable — keep pinyin on */
    }

    try {
      const loaded = await Promise.all(
        characters.split('').map(async (character) => {
          const [set, entry] = await Promise.all([
            loadStrokes(character).catch((err) => {
              console.error('worksheet: stroke load failed', character, err);
              return null;
            }),
            lookup(character).catch(() => null),
          ]);
          return { character, set, entry, hasData: Boolean(set?.strokes.length) };
        })
      );

      if (!alive) return;

      generatedCards = loaded;

      const pages = document.createElement('div');
      pages.className = 'ws-pages';
      let canvases;
      if (options.style === 'rows') {
        canvases = await renderWorksheetPages(loaded, {
          copies: options.copies,
          showSteps: options.showSteps,
          showPinyin: options.showPinyin && pinyinOn,
          dpi: 200,
          labels: sheetLabels(),
        });
      } else {
        canvases = await renderCardsPages(loaded, {
          rowsPerChar: options.rowsPerChar,
          showPinyin: options.showPinyin && pinyinOn,
          showMeaning: options.showMeaning,
          maxCellPt: (CELL_SIZES[options.cellSize]?.size ?? 42) * 2,
          dpi: 200,
          labels: sheetLabels(),
        });
      }
      if (!alive) return;
      sheetsToCanvases(canvases, pages);
      sheetBox.classList.add(options.style === 'rows' ? 'ws-rows' : 'ws-cards');
      sheetBox.classList.remove(options.style === 'rows' ? 'ws-cards' : 'ws-rows');
      sheetBox.append(pages);

      sheetBox.hidden = false;
      printBtn.disabled = false;
      pdfBtn.disabled = false;
      hint.textContent = '';
    } catch (err) {
      console.error('worksheet: generate failed', err);
      hint.textContent = t('worksheet.generateError');
    }
  }

  /** Turn rendered page canvases into labelled `.ws-page` nodes (preview). */
  function sheetsToCanvases(canvases, pages) {
    canvases.forEach((canvas, index) => {
      canvas.className = 'ws-page';
      canvas.dataset.page = String(index + 1);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', t('worksheet.pageFooter', { current: index + 1, total: canvases.length }));
      pages.append(canvas);
    });
  }

  /** Header/footer text of the printable page (es/en via i18n). */
  function sheetLabels() {
    return {
      title: t('worksheet.title'),
      name: t('worksheet.nameField'),
      date: dateStamp(),
      pageText: (current, total) => t('worksheet.pageFooter', { current, total }),
    };
  }

  /** Rows-style page canvases at the requested raster resolution. */
  function renderRowsCanvases(pinyinOn, dpi) {
    return renderWorksheetPages(generatedCards, {
      copies: options.copies,
      showSteps: options.showSteps,
      showPinyin: options.showPinyin && pinyinOn,
      dpi,
      labels: sheetLabels(),
    });
  }

  /** Cards-style page canvases (same drawing as the preview and the PDF, I15). */
  function renderCardsCanvases(pinyinOn, dpi) {
    return renderCardsPages(generatedCards, {
      rowsPerChar: options.rowsPerChar,
      showPinyin: options.showPinyin && pinyinOn,
      showMeaning: options.showMeaning,
      maxCellPt: (CELL_SIZES[options.cellSize]?.size ?? 42) * 2,
      dpi,
      labels: sheetLabels(),
    });
  }

  /**
   * Rows-style PDF images: 200 dpi / JPEG q=0.85 while the whole file stays
   * under 3 MB (20 characters), otherwise fall back to the old 150 dpi.
   */
  async function renderRowsPdfImages(pinyinOn) {
    let images = await canvasesToJpegs(await renderRowsCanvases(pinyinOn, 200), 0.85);
    const total = images.reduce((sum, image) => sum + image.jpeg.length, 0);
    if (total > 3 * 1024 * 1024) {
      images = await canvasesToJpegs(await renderRowsCanvases(pinyinOn, 150), 0.85);
    }
    return images;
  }

  /**
   * Download a real .pdf: render the sheet to A4 canvases, pack them with
   * src/pdf.js and hand the Blob to navigator.share (mobile) or an <a download>.
   */
  async function onDownloadPdf() {
    if (!generatedCards.length) return;
    pdfBtn.disabled = true;
    hint.textContent = t('worksheet.generatingPdf');
    try {
      let pinyinOn = true;
      try {
        const settings = await getSettings();
        pinyinOn = settings.pinyin !== false;
      } catch {
        /* settings unavailable — keep pinyin on */
      }

      const images = options.style === 'rows'
        ? await renderRowsPdfImages(pinyinOn)
        : await canvasesToJpegs(await renderCardsCanvases(pinyinOn, 200), 0.85);
      const bytes = buildPdf(images);
      const filename = `hoja-caligrafia-${dateStamp()}.pdf`;
      const blob = new Blob([bytes], { type: 'application/pdf' });
      lastPdfBlob = blob;

      const file = new File([blob], filename, { type: 'application/pdf' });
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          hint.textContent = '';
          return;
        } catch (err) {
          if (err?.name === 'AbortError') {
            hint.textContent = '';
            return;
          }
          // share failed for good — fall through to the anchor download
          console.error('worksheet: share failed, downloading instead', err);
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      hint.textContent = t('worksheet.pdfReady');
    } catch (err) {
      console.error('worksheet: pdf failed', err);
      hint.textContent = t('worksheet.pdfError');
    } finally {
      pdfBtn.disabled = false;
    }
  }

  container.worksheetApi = {
    state: () => ({
      characters: generatedCards.map((c) => c.character),
      cards: generatedCards.map((c) => {
        const strokes = c.set?.strokes.length ?? 0;
        return {
          character: c.character,
          hasData: c.hasData,
          strokes,
          steps: options.style === 'rows' && options.showSteps ? strokes : 0,
          rows: options.rowsPerChar,
          cellsPerRow: options.style === 'rows' ? planWorksheet([c], options).cellsPerRow : 2,
        };
      }),
      style: options.style,
      copies: options.copies,
      showSteps: options.showSteps,
      options: { ...options },
    }),
    /** Last generated PDF Blob (or null), for headless checks. */
    pdfBlob: () => lastPdfBlob,
    /** Re-render the current sheet to JPEG pages (headless checks). */
    pdfPages: async (pinyinOn = true) => {
      if (options.style !== 'rows') return canvasesToJpegs(await renderCardsCanvases(pinyinOn, 200), 0.85);
      return canvasesToJpegs(await renderRowsCanvases(pinyinOn, 200), 0.85);
    },
  };

  return () => {
    alive = false;
    if (container.worksheetApi) delete container.worksheetApi;
  };
}