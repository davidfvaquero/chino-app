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
import { loadStrokes, strokeDiagramSvg, VIEW_BOX_SIZE } from '../learn/strokes.js';
import { lookup } from '../dictionary.js';
import { pinyinHtml } from '../tone.js';
import { getDueCards } from '../srs.js';
import { loadIndex } from '../learn/lessons.js';
import { getSettings } from '../settings.js';
import { buildPdf } from '../pdf.js';

export const titleKey = 'worksheet.title';
export const MAX_CHARACTERS = 20;
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

// 150 dpi raster: 595.28×841.89 pt × 150/72 ≈ 1240×1754 px (A4 portrait).
const PDF_PX_PER_PT = 150 / 72;
const PDF_PAGE_W = Math.round(595.28 * PDF_PX_PER_PT);
const PDF_PAGE_H = Math.round(841.89 * PDF_PX_PER_PT);
const PDF_CELL_PX = { small: 80, medium: 96, large: 120 };
// Hanzi fonts available on Android/iOS/desktop; falls back to the system UI font.
const PDF_FONT = '"Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const PDF_INK = '#1a1a1a';       // dark ink (light/dark theme both -> dark ink on white)
const PDF_LINE = '#c4c4c4';      // 田字格 guide lines
const PDF_GUIDE = 'rgba(26, 26, 26, 0.34)'; // gray model hanzi
const PDF_BG = '#ffffff';

/** Draw one 田字格 cell: border + dashed centre cross/diagonals + optional gray hanzi. */
function drawTianCell(ctx, x, y, size, character) {
  ctx.save();
  ctx.strokeStyle = PDF_LINE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, size - 1.5, size - 1.5);
  ctx.beginPath();
  ctx.setLineDash([7, 7]);
  const mid = size / 2;
  ctx.moveTo(x, y + mid);
  ctx.lineTo(x + size, y + mid);
  ctx.moveTo(x + mid, y);
  ctx.lineTo(x + mid, y + size);
  ctx.moveTo(x, y);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.setLineDash([]);
  if (character) {
    ctx.fillStyle = PDF_GUIDE;
    ctx.font = `${Math.round(size * 0.82)}px ${PDF_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(character, x + mid, y + size * 0.55);
  }
  ctx.restore();
}

/** Draw a character block: header (hanzi + optional pinyin/meaning) then rows of model+empty cells. */
function drawCharBlock(ctx, card, { x, y, cellPx, rows, gap, showPinyin, showMeaning, pinyinOn }) {
  const charSize = Math.round(cellPx * 0.95);
  const entry = card.entry;
  ctx.fillStyle = PDF_INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${charSize}px ${PDF_FONT}`;
  ctx.fillText(card.character, x, y + charSize);

  const tx = x + ctx.measureText(card.character).width + cellPx * 0.25;
  let ty = y + charSize * 0.45;
  if (showPinyin && pinyinOn && entry?.pinyinTone) {
    ctx.font = `400 ${Math.round(charSize * 0.42)}px ${PDF_FONT}`;
    ctx.fillText(entry.pinyinTone, tx, ty);
    ty += charSize * 0.5;
  }
  if (showMeaning && entry?.defs?.length) {
    ctx.font = `400 ${Math.round(charSize * 0.28)}px ${PDF_FONT}`;
    ctx.fillText(entry.defs.slice(0, 2).join('; '), tx, ty);
  }

  const cellsTop = y + charSize + Math.round(cellPx * 0.2);
  for (let row = 0; row < rows; row += 1) {
    const cy = cellsTop + row * (cellPx + gap);
    drawTianCell(ctx, x, cy, cellPx, card.character);            // model (gray guide)
    drawTianCell(ctx, x + cellPx + gap, cy, cellPx, null);       // empty (write here)
  }
  return cellsTop + rows * cellPx + (rows - 1) * gap - y; // block height
}

/**
 * Render the generated cards to one or more A4 canvases (~150 dpi) and encode
 * each as a JPEG. New page when a block would not fit. Browser-only (canvas/Blob).
 * @returns {Promise<Array<{jpeg: Uint8Array, width: number, height: number}>>}
 */
async function renderSheetToPages(cards, options, { pinyinOn = true } = {}) {
  const cellPx = PDF_CELL_PX[options.cellSize] ?? PDF_CELL_PX.medium;
  const rows = Math.min(10, Math.max(3, Math.floor(options.rowsPerChar) || 3));
  const margin = 72;
  const gap = 16;
  const blockGap = 48;
  const charSize = Math.round(cellPx * 0.95);
  const blockH = charSize + Math.round(cellPx * 0.2) + rows * cellPx + (rows - 1) * gap;
  const usableBottom = PDF_PAGE_H - margin;

  const pages = [];
  let ctx = null;
  let y = margin;
  const newPage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PDF_PAGE_W;
    canvas.height = PDF_PAGE_H;
    ctx = canvas.getContext('2d');
    ctx.fillStyle = PDF_BG;
    ctx.fillRect(0, 0, PDF_PAGE_W, PDF_PAGE_H);
    pages.push(canvas);
    y = margin;
  };
  newPage();

  for (const card of cards) {
    if (y + blockH > usableBottom && y > margin) newPage();
    const height = drawCharBlock(ctx, card, {
      x: margin,
      y,
      cellPx,
      rows,
      gap,
      showPinyin: options.showPinyin,
      showMeaning: options.showMeaning,
      pinyinOn,
    });
    y += height + blockGap;
  }

  const out = [];
  for (const canvas of pages) {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/jpeg',
        0.92,
      );
    });
    out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  return out;
}

/** Local YYYY-MM-DD stamp for the PDF filename. */
export function dateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
.ws-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ws-warning { margin: 0; color: var(--accent); font-size: 0.85rem; }
.ws-hint { margin: 0; min-height: 1.2em; opacity: 0.8; font-size: 0.9rem; }

.ws-sheet { display: flex; flex-direction: column; gap: 1rem; }
.ws-char-block { page-break-inside: avoid; break-inside: avoid; display: flex; flex-direction: column; gap: 0.5rem; }
.ws-char-head { display: flex; flex-direction: column; align-items: flex-start; gap: 0.3rem; }
.ws-char-large { font-size: 4.5rem; line-height: 1; }
.ws-char-pinyin { font-size: 1.2rem; }
.ws-char-meaning { display: block; opacity: 0.8; font-size: 0.95rem; }
.ws-char-stroke-count { opacity: 0.7; font-variant-numeric: tabular-nums; font-size: 0.85rem; }

.ws-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem; }
.ws-cell { aspect-ratio: 1 / 1; border: 1px solid var(--line); border-radius: 0.3rem; background: var(--bg); position: relative; display: flex; align-items: center; justify-content: center; }
.ws-cell.model { opacity: 0.35; }
.ws-cell.empty { background: transparent; }
.ws-cell svg { display: block; width: 85%; height: 85%; }
.ws-cell .tian-grid { position: absolute; inset: 0; pointer-events: none; stroke: currentColor; stroke-width: 0.5; opacity: 0.2; }
.ws-cell .tian-grid line { vector-effect: non-scaling-stroke; stroke-width: 1px; }


@media print {
  .ws-form, .ws-actions, .ws-hint, .ws-warning { display: none !important; }
  .worksheet { gap: 0.5rem; }
  .ws-char-block { margin-bottom: 0.75rem; }
  .ws-char-large { font-size: 3.5rem; }
  .ws-grid { gap: 0.25rem; }
  .ws-cell { border-color: var(--line); }
  @page { size: A4 portrait; margin: 1.5cm; }
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

/** SVG for 田字格 grid lines (center cross + diagonals) inside the cell viewBox. */
function tianGridSvg(size = VIEW_BOX_SIZE) {
  const half = size / 2;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.classList.add('tian-grid');
  svg.setAttribute('aria-hidden', 'true');
  // center horizontal
  svg.appendChild(createSvgLine(svgNS, 0, half, size, half));
  // center vertical
  svg.appendChild(createSvgLine(svgNS, half, 0, half, size));
  // diagonals
  svg.appendChild(createSvgLine(svgNS, 0, 0, size, size));
  svg.appendChild(createSvgLine(svgNS, size, 0, 0, size));
  return svg;
}

function createSvgLine(ns, x1, y1, x2, y2) {
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  return line;
}

/** Render a single character block into a document fragment. */
async function renderCharBlock(character, set, entry, options, cellSize) {
  const { rowsPerChar, showPinyin, showMeaning } = options;
  const frag = document.createDocumentFragment();

  const block = document.createElement('div');
  block.className = 'ws-char-block';
  block.dataset.character = character;

  // Header: large character + stroke diagram + pinyin + meaning
  const head = document.createElement('div');
  head.className = 'ws-char-head';

  const charLarge = document.createElement('span');
  charLarge.className = 'ws-char-large';
  charLarge.textContent = character;
  head.append(charLarge);

  // Stroke order diagram (numbered)
  const diagramWrap = document.createElement('div');
  diagramWrap.style.display = 'inline-flex';
  diagramWrap.style.alignItems = 'center';
  diagramWrap.style.gap = '0.5rem';
  const diagramSvg = strokeDiagramSvg(set, { upTo: set.strokes.length });
  diagramSvg.style.width = '4.5rem';
  diagramSvg.style.height = '4.5rem';
  diagramSvg.style.background = 'var(--surface)';
  diagramSvg.style.borderRadius = '0.4rem';
  diagramSvg.style.flexShrink = '0';
  diagramWrap.append(diagramSvg);
  head.append(diagramWrap);

  if (showPinyin && entry?.pinyinTone) {
    const pinyinEl = document.createElement('span');
    pinyinEl.className = 'ws-char-pinyin py-keep';
    pinyinEl.innerHTML = pinyinHtml(entry.pinyinTone);
    head.append(pinyinEl);
  }
  if (showMeaning && entry?.defs?.length) {
    const meaningEl = document.createElement('span');
    meaningEl.className = 'ws-char-meaning';
    meaningEl.textContent = entry.defs.slice(0, 2).join('; ');
    head.append(meaningEl);
  }
  const countEl = document.createElement('span');
  countEl.className = 'ws-char-stroke-count';
  countEl.textContent = t('worksheet.strokesCount', { count: set.strokes.length });
  head.append(countEl);

  block.append(head);

  // Grid: rowsPerChar rows × 2 cols (model + empty)
  const grid = document.createElement('div');
  grid.className = 'ws-grid';
  grid.style.gridTemplateColumns = `repeat(2, ${cellSize}px)`;

  for (let row = 0; row < rowsPerChar; row++) {
    // Model cell (left)
    const modelCell = document.createElement('div');
    modelCell.className = 'ws-cell model';
    modelCell.style.width = `${cellSize}px`;
    modelCell.style.height = `${cellSize}px`;
    if (set) {
      const modelSvg = strokeDiagramSvg(set, { upTo: set.strokes.length });
      modelSvg.style.width = '85%';
      modelSvg.style.height = '85%';
      modelCell.append(modelSvg);
    }
    modelCell.append(tianGridSvg());
    grid.append(modelCell);

    // Empty cell (right)
    const emptyCell = document.createElement('div');
    emptyCell.className = 'ws-cell empty';
    emptyCell.style.width = `${cellSize}px`;
    emptyCell.style.height = `${cellSize}px`;
    emptyCell.append(tianGridSvg());
    grid.append(emptyCell);
  }

  block.append(grid);
  frag.append(block);
  return frag;
}

export async function render(container, ctx) {
  ensureStyles(document);

  // State
  let characters = '';
  let options = {
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

  const optionsDiv = h('div', { class: 'ws-options' },
    h('div', { class: 'ws-opt-group' },
      h('span', { class: 'ws-opt-label', text: t('worksheet.cellSizeLabel') }),
      cellSizeSelect,
    ),
    h('div', { class: 'ws-opt-group' },
      h('span', { class: 'ws-opt-label', text: t('worksheet.rowsLabel') }),
      rowsSelect,
    ),
    h('label', { class: 'ws-checkbox' }, showPinyinCheckbox, t('worksheet.showPinyin')),
    h('label', { class: 'ws-checkbox' }, showMeaningCheckbox, t('worksheet.showMeaning')),
  );

  const generateBtn = h('button', {
    type: 'button',
    class: 'ws-btn primary',
    text: t('worksheet.generate'),
    onclick: onGenerate,
  });
  const printBtn = h('button', {
    type: 'button',
    class: 'ws-btn',
    text: t('worksheet.print'),
    onclick: () => window.print(),
    disabled: true,
  });
  const pdfBtn = h('button', {
    type: 'button',
    class: 'ws-btn primary',
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
      const cellSize = CELL_SIZES[options.cellSize].size;

      for (const card of loaded) {
        if (card.hasData && card.set) {
          const block = await renderCharBlock(card.character, card.set, card.entry, options, cellSize);
          sheetBox.append(block);
        } else {
          // No stroke data — show placeholder block
          const block = document.createElement('div');
          block.className = 'ws-char-block';
          block.dataset.character = card.character;
          const head = document.createElement('div');
          head.className = 'ws-char-head';
          const charLarge = document.createElement('span');
          charLarge.className = 'ws-char-large';
          charLarge.textContent = card.character;
          head.append(charLarge);
          if (options.showPinyin && card.entry?.pinyinTone) {
            const pinyinEl = document.createElement('span');
            pinyinEl.className = 'ws-char-pinyin py-keep';
            pinyinEl.innerHTML = pinyinHtml(card.entry.pinyinTone);
            head.append(pinyinEl);
          }
          if (options.showMeaning && card.entry?.defs?.length) {
            const meaningEl = document.createElement('span');
            meaningEl.className = 'ws-char-meaning';
            meaningEl.textContent = card.entry.defs.slice(0, 2).join('; ');
            head.append(meaningEl);
          }
          const emptyMsg = document.createElement('p');
          emptyMsg.style.color = 'var(--ink-soft)';
          emptyMsg.style.fontSize = '0.9rem';
          emptyMsg.textContent = t('worksheet.noStrokeData', { char: card.character });
          block.append(head, emptyMsg);
          sheetBox.append(block);
        }
      }

      sheetBox.hidden = false;
      printBtn.disabled = false;
      pdfBtn.disabled = false;
      hint.textContent = '';
    } catch (err) {
      console.error('worksheet: generate failed', err);
      hint.textContent = t('worksheet.generateError');
    }
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

      const images = await renderSheetToPages(generatedCards, options, { pinyinOn });
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
      cards: generatedCards.map((c) => ({
        character: c.character,
        hasData: c.hasData,
        strokes: c.set?.strokes.length ?? 0,
        rows: options.rowsPerChar,
        cellsPerRow: 2,
      })),
      options: { ...options },
    }),
    /** Last generated PDF Blob (or null), for headless checks. */
    pdfBlob: () => lastPdfBlob,
    /** Re-render the current sheet to JPEG pages (headless checks). */
    pdfPages: () => renderSheetToPages(generatedCards, options, { pinyinOn: true }),
  };

  return () => {
    alive = false;
    if (container.worksheetApi) delete container.worksheetApi;
  };
}