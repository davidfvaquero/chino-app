/**
 * worksheet-rows.js — "one row per character + stroke-order steps" sheet.
 *
 * Single implementation shared by the on-screen preview and the PDF download
 * (src/extras/worksheet.js renders the returned canvases in both places).
 *
 * Each row:
 *   - a small line above the cells: pinyin on the left, then the step strip —
 *     N tiny glyphs, step k = strokes 1..k (stroke k in ink, earlier ones dark
 *     grey) so the pupil sees which stroke is added;
 *   - a row of square 田字格 cells: cell 1 = model in black, cells 2..copies+1 =
 *     the same character in light grey to trace, the rest empty.
 *
 * Stroke outlines come from Make Me a Hanzi (src/learn/strokes.js `loadStrokes`,
 * already orientation-corrected with OUTLINE_FLIP — reused here, never changed).
 *
 * Pure, browser-free helpers (tests/worksheet-rows.test.mjs):
 *   clampCopies(value)                      -> 0..8 (default 4)
 *   planStepStrip(strokes, {availW, stepH}) -> {steps, lines, stepPt, perLine}
 *   planWorksheet(cards, options)           -> layout + pagination + rows
 * Browser-only drawing:
 *   drawWorksheetPage(ctx, page, plan, opts)
 *   renderWorksheetPages(cards, options)    -> Promise<HTMLCanvasElement[]>
 */
import { buildSteps } from '../learn/strokes-sheet.js';

/** A4 portrait, in PDF points (72 dpi). */
export const A4 = { width: 595.28, height: 841.89 };

export const MIN_COPIES = 0;
export const MAX_COPIES = 8;
export const DEFAULT_COPIES = 4;
export const DEFAULT_CELLS_PER_ROW = 14;

/** Print metrics, in points. Cell ≈ 13 mm (515 pt / 14). */
export const METRICS = {
  marginX: 40,
  marginTop: 30,
  marginBottom: 26,
  headerH: 56,
  footerH: 24,
  stepH: 15, // ~5.3 mm step strip height
  stripGap: 1,
  rowGap: 5,
  pinyinW: 74,
  pinyinGap: 6,
};

const floor1 = (value) => Math.round(value * 10) / 10;

/** Copies of the grey model: integer 0..8, default 4 for anything unusable. */
export function clampCopies(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_COPIES;
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, number));
}

/**
 * Size of the step glyphs: shrink so the whole strip fits one line; split the
 * strip in two lines when it would get too small (roughly >30 strokes).
 */
export function planStepStrip(strokes, { availW, stepH = METRICS.stepH } = {}) {
  const total = Math.max(0, Math.floor(Number(strokes) || 0));
  const width = Math.max(0, Number(availW) || 0);
  if (!total) return { steps: 0, lines: 1, stepPt: stepH, perLine: 0 };
  const minStep = Math.max(6, Math.round(stepH * 0.85 * 10) / 10);
  let lines = 1;
  let stepPt = Math.min(stepH, floor1(width / total));
  if (stepPt < minStep) {
    lines = 2;
    stepPt = Math.min(stepH, floor1(width / Math.ceil(total / 2)));
  }
  if (stepPt < minStep) stepPt = minStep;
  const perLine = Math.max(1, Math.floor(width / stepPt));
  return { steps: total, lines, stepPt, perLine };
}

/**
 * Full worksheet plan: cell width, step strips, rows and pages.
 *
 * @param {Array<{character:string, pinyin?:string, strokes?:number, entry?:object, set?:object}>} cards
 * @param {{copies?:number, showSteps?:boolean, showPinyin?:boolean,
 *          cellsPerRow?:number, pageW?:number, pageH?:number, metrics?:object}} options
 * @returns {{copies, cellsPerRow, cellPt, showSteps, showPinyin, pinyinW, stripX,
 *            availW, top, bottom, usableW, usableH, pageW, pageH, metric,
 *            rows:Array, pages:Array<Array>, rowsPerPage:number}}
 */
export function planWorksheet(cards, options = {}) {
  const copies = clampCopies(options.copies);
  const showSteps = options.showSteps !== false;
  const showPinyin = options.showPinyin !== false;
  const cellsPerRow = Math.max(1, Math.floor(options.cellsPerRow ?? DEFAULT_CELLS_PER_ROW));
  const pageW = Number(options.pageW) || A4.width;
  const pageH = Number(options.pageH) || A4.height;
  const metric = { ...METRICS, ...(options.metrics ?? {}) };

  const usableW = pageW - metric.marginX * 2;
  const cellPt = usableW / cellsPerRow;
  const pinyinW = showPinyin ? Math.min(metric.pinyinW, usableW * 0.2) : 0;
  const stripX = metric.marginX + (pinyinW ? pinyinW + metric.pinyinGap : 0);
  const availW = usableW - (pinyinW ? pinyinW + metric.pinyinGap : 0);
  const top = metric.marginTop + metric.headerH;
  const bottom = pageH - metric.marginBottom - metric.footerH;
  const usableH = bottom - top;

  const rows = (Array.isArray(cards) ? cards : []).map((card) => {
    const strokes = Math.max(0, Math.floor(card?.strokes ?? card?.set?.strokes?.length ?? 0));
    const strip = planStepStrip(showSteps ? strokes : 0, { availW, stepH: metric.stepH });
    const cells = Array.from({ length: cellsPerRow }, (_, index) => {
      if (index === 0) return 'model';
      if (index <= copies) return 'copy';
      return 'empty';
    });
    return {
      character: String(card?.character ?? ''),
      pinyin: showPinyin ? String(card?.pinyin ?? card?.entry?.pinyinTone ?? '') : '',
      card,
      strokes,
      // step k (0-based) holds the first k+1 strokes; the last step is complete.
      steps: showSteps ? buildSteps(strokes) : [],
      strip,
      cells,
      height: (showSteps ? strip.stepPt * strip.lines : 0) + metric.stripGap + cellPt + metric.rowGap,
    };
  });

  const pages = [];
  let page = [];
  let used = 0;
  for (const row of rows) {
    if (page.length && used + row.height > usableH) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(row);
    used += row.height;
  }
  if (page.length) pages.push(page);

  const rowPitch = metric.stepH + metric.stripGap + cellPt + metric.rowGap;
  return {
    copies,
    cellsPerRow,
    cellPt,
    showSteps,
    showPinyin,
    pinyinW,
    stripX,
    availW,
    top,
    bottom,
    usableW,
    usableH,
    pageW,
    pageH,
    metric,
    rows,
    pages,
    rowsPerPage: Math.max(1, Math.floor(usableH / rowPitch)),
  };
}

/* -------------------------------------------------------------- drawing --- */

const FONT = '"Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const INK = '#1a1a1a';
const OLD_STROKE = '#5a5a5a';
const GUIDE = '#c9c9c9';
const COPY = 'rgba(26, 26, 26, 0.30)';

/** Fills strokes `indices` of `set` inside the square (x, y, size). */
export function drawGlyph(ctx, set, indices, x, y, size, { color = INK, accentIndex = -1, accentColor = INK } = {}) {
  if (!set?.strokes?.length || !indices.length) return false;
  const scale = size / 1024;
  indices.forEach((index) => {
    const path = set.strokes[index];
    if (!path) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, -scale);
    ctx.translate(0, -900); // OUTLINE_FLIP: Make Me a Hanzi is y-UP, baseline 900
    ctx.fillStyle = index === accentIndex ? accentColor : color;
    ctx.fill(new Path2D(path));
    ctx.restore();
  });
  return true;
}

/** Model glyph: outlines when the dataset has them, the plain character otherwise. */
function drawCharacter(ctx, row, x, y, size, color) {
  const set = row.card?.set;
  if (drawGlyph(ctx, set, (set?.strokes ?? []).map((_, index) => index), x, y, size, { color })) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `400 ${Math.round(size * 0.9)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(row.character, x + size / 2, y + size * 0.54);
  ctx.restore();
}

/** 田字格 cell: thin square border + dashed centre cross/diagonals. */
export function drawTianCell(ctx, x, y, size) {
  ctx.save();
  ctx.strokeStyle = GUIDE;
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x + 0.35, y + 0.35, size - 0.7, size - 0.7);
  ctx.setLineDash([2, 2.4]);
  ctx.beginPath();
  ctx.moveTo(x, y + size / 2);
  ctx.lineTo(x + size, y + size / 2);
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size / 2, y + size);
  ctx.moveTo(x, y);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw one planned page. Coordinates are PDF points; the caller scales the
 * context (`ctx.setTransform(dpi/72, 0, 0, dpi/72, 0, 0)`) for raster output.
 */
export function drawWorksheetPage(ctx, page, plan, { labels = {}, pageIndex = 0, pageCount = 1 } = {}) {
  const { metric: m } = plan;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.pageW, plan.pageH);

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(labels.title ?? '', m.marginX, m.marginTop + 13);

  ctx.font = `400 9px ${FONT}`;
  ctx.fillText(`${labels.name ?? 'Name'}: ____________________`, m.marginX, m.marginTop + 36);
  ctx.textAlign = 'right';
  ctx.fillText(labels.date ?? '', m.marginX + plan.usableW, m.marginTop + 36);
  ctx.textAlign = 'left';

  let y = plan.top;
  for (const row of page) {
    const stripH = row.strip.lines * row.strip.stepPt;
    // Pinyin is printed whenever the sheet asks for it, not only with steps.
    if (row.pinyin) {
      ctx.fillStyle = INK;
      ctx.font = `600 9px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(row.pinyin, m.marginX, y + stripH / 2);
      ctx.textBaseline = 'alphabetic';
    }
    if (plan.showSteps) {
      const set = row.card?.set;
      row.steps.forEach((step, index) => {
        const line = Math.floor(index / row.strip.perLine);
        const column = index % row.strip.perLine;
        const gx = plan.stripX + column * row.strip.stepPt;
        const gy = y + line * row.strip.stepPt;
        drawGlyph(ctx, set, step.strokes, gx, gy, row.strip.stepPt * 0.96, {
          color: OLD_STROKE,
          accentIndex: step.newStroke,
          accentColor: INK,
        });
      });
    }

    const cy = y + stripH + m.stripGap;
    row.cells.forEach((kind, index) => {
      const cx = m.marginX + index * plan.cellPt;
      drawTianCell(ctx, cx, cy, plan.cellPt);
      if (kind === 'empty') return;
      const size = plan.cellPt * 0.9;
      const gx = cx + (plan.cellPt - size) / 2;
      const gy = cy + (plan.cellPt - size * (900 / 1024)) / 2;
      drawCharacter(ctx, row, gx, gy, size, kind === 'model' ? INK : COPY);
    });

    y += row.height;
  }

  ctx.fillStyle = '#444444';
  ctx.font = `400 8px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    typeof labels.pageText === 'function' ? labels.pageText(pageIndex + 1, pageCount) : labels.pageText ?? '',
    plan.pageW / 2,
    plan.pageH - m.marginBottom / 2,
  );
  ctx.restore();
}

/**
 * Render the whole sheet to one A4 canvas per page (200 dpi by default).
 * Browser-only. Same canvases feed the on-screen preview and the PDF.
 * @returns {Promise<HTMLCanvasElement[]>}
 */
export async function renderWorksheetPages(cards, options = {}) {
  const plan = planWorksheet(cards, options);
  const dpi = Math.max(72, Number(options.dpi) || 200);
  const scale = dpi / 72;
  const labels = options.labels ?? {};
  const canvases = [];
  plan.pages.forEach((page, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(plan.pageW * scale);
    canvas.height = Math.round(plan.pageH * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawWorksheetPage(ctx, page, plan, { labels, pageIndex: index, pageCount: plan.pages.length });
    canvases.push(canvas);
  });
  return canvases;
}
