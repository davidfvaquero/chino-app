/**
 * strokes-ui.css.js — the stroke-screen stylesheet (docs/REVIEW-2.md I14 split
 * of `src/learn/strokes.js`). One injection per document, id `strokes-style`.
 */
const STYLE_ID = 'strokes-style';
const STROKE_WIDTH = 46;
const PEN_WIDTH = 34;

const CSS = `
.strokes { display: flex; flex-direction: column; gap: 0.75rem; }
.strokes [hidden] { display: none !important; }
.strokes-search { display: flex; gap: 0.5rem; align-items: center; }
.strokes-search input { flex: 1; min-width: 0; padding: 0.6rem 0.7rem; font-size: 1.05rem; min-height: 48px; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.strokes-search .strokes-go { min-height: 44px; padding: 0.6rem 1rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font-size: var(--fs-base); }
.strokes-results { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.strokes-results button { font-size: 1.4rem; line-height: 1; min-height: 44px; padding: 0.35rem 0.55rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.strokes-board { position: relative; width: 100%; max-width: 22rem; margin: 0 auto; }
.strokes-svg { display: block; width: 100%; aspect-ratio: 1 / 1; touch-action: none; border-radius: 0.75rem; background: var(--surface); }
.strokes-guide { stroke: var(--edge); stroke-width: 2; stroke-dasharray: 5 4; fill: none; }
.strokes-ghost { fill: var(--ink-soft); opacity: 0.7; }
.strokes-ink { fill: none; stroke: var(--ink); stroke-width: ${STROKE_WIDTH}; stroke-linecap: round; stroke-linejoin: round; }
.strokes-trace-guide { fill: none; stroke: var(--accent); stroke-width: 10; stroke-linecap: round; stroke-dasharray: 18 22; opacity: 0.8; }
.strokes-trace-guide[data-current="true"] { opacity: 1; stroke-width: 14; }
.strokes-trace-done { fill: var(--ink); opacity: 0.85; }
.strokes-trace-drawn { fill: none; stroke: var(--tone3); stroke-width: ${PEN_WIDTH}; stroke-linecap: round; stroke-linejoin: round; }
.strokes-trace-drawn[data-result="wrong"] { stroke: var(--danger); }
.strokes-progress { margin: 0; text-align: center; font-variant-numeric: tabular-nums; opacity: 0.8; }
.strokes-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.strokes-actions button { min-height: 44px; padding: 0.55rem 0.8rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font-size: 0.95rem; }
.strokes-actions button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.strokes-hint, .strokes-empty { margin: 0; text-align: center; min-height: 1.2em; }
.strokes-examples { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; }
`;

export function ensureStrokesStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
