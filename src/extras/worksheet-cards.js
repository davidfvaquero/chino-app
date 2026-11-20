/**
 * worksheet-cards.js — "fichas": one block per character (big character, its
 * stroke diagram, pinyin/meaning) + rows of 田字格 cells (model + empty).
 *
 * Single implementation shared by the on-screen preview and the PDF download:
 * `worksheet.js` renders the returned canvases in both places, so the preview
 * and the PDF are literally the same drawing (docs/REVIEW-2.md I15). The model
 * cells and the big character are drawn from the stroke outlines (drawGlyph),
 * so no system CJK font is needed (no tofu).
 *
 * Pure, browser-free helpers (tests/worksheet.test.mjs):
 *   planCards(cards, options) -> layout + pagination
 * Browser-only drawing:
 *   drawCardsPage(ctx, page, plan, opts)
 *   renderCardsPages(cards, options) -> Promise<HTMLCanvasElement[]>
 */
import { A4, drawGlyph, drawTianCell } from './worksheet-rows.js';

export const DEFAULT_ROWS_PER_CHAR = 5;
const MIN_ROWS = 3;
const MAX_ROWS = 10;

export const CARD_METRICS = {
  marginX: 48,
  marginTop: 30,
  marginBottom: 26,
  headerH: 72,
  footerH: 26,
  blockGap: 20,
  cellGap: 8,
  maxCellPt: 120,
};

const FONT = '"Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const INK = '#1a1a1a';
const SOFT = '#555555';
const MODEL = 'rgba(26, 26, 26, 0.42)';

const clampRows = (value) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_ROWS_PER_CHAR;
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, n));
};

/**
 * @param {Array<{character:string, entry?:object, set?:object}>} cards
 * @param {{rowsPerChar?:number, showPinyin?:boolean, showMeaning?:boolean,
 *          pageW?:number, pageH?:number, metrics?:object, maxCellPt?:number}} options
 */
export function planCards(cards, options = {}) {
  const rowsPerChar = clampRows(options.rowsPerChar);
  const showPinyin = options.showPinyin !== false;
  const showMeaning = options.showMeaning !== false;
  const pageW = Number(options.pageW) || A4.width;
  const pageH = Number(options.pageH) || A4.height;
  const m = { ...CARD_METRICS, ...(options.metrics ?? {}) };
  const usableW = pageW - m.marginX * 2;
  const cellPt = Math.min((usableW - m.cellGap) / 2, Number(options.maxCellPt) || m.maxCellPt);
  const gridW = cellPt * 2 + m.cellGap;
  const blockH = m.headerH + rowsPerChar * cellPt + (rowsPerChar - 1) * m.cellGap + m.blockGap;
  const top = m.marginTop;
  const bottom = pageH - m.marginBottom - m.footerH;

  const blocks = (Array.isArray(cards) ? cards : []).map((card) => ({
    character: String(card?.character ?? ''),
    pinyin: showPinyin ? String(card?.entry?.pinyinTone ?? card?.pinyin ?? '') : '',
    meaning: showMeaning ? (card?.entry?.defs ?? []).slice(0, 2).join('; ') : '',
    strokes: Math.max(0, Math.floor(card?.set?.strokes?.length ?? card?.strokes ?? 0)),
    card,
    rows: rowsPerChar,
    height: blockH,
  }));

  const pages = [];
  let page = [];
  let used = 0;
  for (const block of blocks) {
    if (page.length && used + block.height > bottom - top) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(block);
    used += block.height;
  }
  if (page.length) pages.push(page);

  return {
    rowsPerChar,
    cellPt,
    gridW,
    cellGap: m.cellGap,
    headerH: m.headerH,
    blockGap: m.blockGap,
    marginX: m.marginX,
    footerH: m.footerH,
    top,
    showPinyin,
    showMeaning,
    pageW,
    pageH,
    blocks,
    pages,
  };
}

/** Draws one character block (header + 田字格 grid) at the current `y`. */
function drawCardBlock(ctx, block, plan, y) {
  const set = block.card?.set;
  const charSize = Math.round(plan.headerH * 0.78);
  const glyphH = charSize * (900 / 1024);
  const charY = y + (plan.headerH - glyphH) / 2;
  const indices = (set?.strokes ?? []).map((_, index) => index);
  if (indices.length) {
    drawGlyph(ctx, set, indices, plan.marginX, charY, charSize, { color: INK });
  } else {
    ctx.save();
    ctx.fillStyle = INK;
    ctx.font = `600 ${charSize}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(block.character, plan.marginX, charY + charSize);
    ctx.restore();
  }

  const tx = plan.marginX + charSize + 14;
  let ty = y + plan.headerH * 0.5;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  if (block.pinyin) {
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(block.pinyin, tx, ty);
    ty += 18;
  }
  if (block.meaning) {
    ctx.font = `400 12px ${FONT}`;
    ctx.fillStyle = SOFT;
    ctx.fillText(block.meaning, tx, ty);
    ty += 14;
  }
  if (block.strokes) {
    ctx.font = `400 10px ${FONT}`;
    ctx.fillStyle = SOFT;
    ctx.fillText(String(block.strokes), tx, ty);
  }
  ctx.textBaseline = 'alphabetic';

  // Grid: rows × 2 cells (model on the left, empty to write on the right).
  const gx0 = plan.marginX;
  const gy0 = y + plan.headerH;
  for (let row = 0; row < block.rows; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const cx = gx0 + col * (plan.cellPt + plan.cellGap);
      const cy = gy0 + row * (plan.cellPt + plan.cellGap);
      drawTianCell(ctx, cx, cy, plan.cellPt);
      if (col !== 0 || !indices.length) continue;
      const size = plan.cellPt * 0.9;
      const sgx = cx + (plan.cellPt - size) / 2;
      const sgy = cy + (plan.cellPt - size * (900 / 1024)) / 2;
      drawGlyph(ctx, set, indices, sgx, sgy, size, { color: MODEL });
    }
  }
}

/** Draw one planned cards page (PDF points; the caller scales for raster). */
export function drawCardsPage(ctx, page, plan, { labels = {}, pageIndex = 0, pageCount = 1 } = {}) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.pageW, plan.pageH);

  let y = plan.top;
  for (const block of page) {
    drawCardBlock(ctx, block, plan, y);
    y += block.height;
  }

  ctx.fillStyle = '#444444';
  ctx.font = `400 8px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    typeof labels.pageText === 'function' ? labels.pageText(pageIndex + 1, pageCount) : labels.pageText ?? '',
    plan.pageW / 2,
    plan.pageH - plan.footerH / 2,
  );
  ctx.restore();
}

/** Render the cards sheet to one A4 canvas per page (200 dpi by default). */
export async function renderCardsPages(cards, options = {}) {
  const plan = planCards(cards, options);
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
    drawCardsPage(ctx, page, plan, { labels, pageIndex: index, pageCount: plan.pages.length });
    canvases.push(canvas);
  });
  return canvases;
}
