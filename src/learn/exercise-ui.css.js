/**
 * exercise-ui.css.js — the exercise kit: option lists, order rows, match grid,
 * right/wrong feedback. Injected once by lessons, tones and dictation (the
 * screens that render exercises through src/learn/exercise-view.js).
 * Base `.btn` / `.chip` / tokens live in src/styles.css (docs/DESIGN.md); this
 * file only adds what an exercise needs on top, so light/dark and the font scale
 * keep working through the shared variables.
 */

const STYLE_ID = 'exercise-ui-style';

export const EXERCISE_UI_CSS = `
.exercise-body { display: grid; gap: var(--gap); }
.exercise-body .prompt { margin: 0; color: var(--ink); font-size: var(--fs-md); font-weight: 600; line-height: 1.4; }
.exercise-body .hint { margin: 0; }
.exercise-body > .btn,
.exercise-body .feedback-box > .btn { width: 100%; }

/* Stacked options (choose / listen / dictation). */
.options { display: grid; gap: 0.5rem; }
.options .btn { width: 100%; min-height: 3.5rem; }
.btn.hz { font: 500 1.75rem/1.2 var(--font-hanzi); }
/* Pinyin under a hanzi option / token chip (P2-1); the reading keeps the UI font. */
.options .btn.option { flex-direction: column; align-items: flex-start; gap: 0.1rem; }
.options .btn.option .pinyin { font-family: var(--font-ui); font-size: var(--fs-sm); font-weight: 500; line-height: 1.2; }
.answer-row .chip,
.pool-row .chip { flex-direction: column; gap: 0.1rem; }
.answer-row .chip .pinyin,
.pool-row .chip .pinyin,
.match-col.left .chip .pinyin { font-family: var(--font-ui); font-size: 0.8rem; font-weight: 500; line-height: 1.2; letter-spacing: 0; }
.match-col.left .chip { flex-direction: column; gap: 0.1rem; }
.btn.is-correct { border-color: var(--ok); background: var(--ok-wash); color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--ok); animation: pop 0.28s var(--ease); }
.btn.is-wrong { border-color: var(--danger); background: var(--danger-wash); color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--danger); animation: shake 0.3s linear; }
.btn.is-missed { border-style: dashed; border-color: var(--ok); }
.btn.is-correct:disabled,
.btn.is-wrong:disabled,
.btn.is-missed:disabled { opacity: 1; }

/* Order: a dashed writing line + the pool of tokens. */
.answer-row,
.pool-row { display: flex; flex-wrap: wrap; gap: 0.5rem; min-height: 56px; padding: 0.5rem; border-radius: var(--r-md); }
.answer-row { align-content: flex-start; border: 1.5px dashed var(--edge); background: var(--inset); }
.pool-row { padding-inline: 0; }
.answer-row.is-ok { border-style: solid; border-color: var(--ok); background: var(--ok-wash); }
.answer-row.is-bad { border-style: solid; border-color: var(--danger); background: var(--danger-wash); }
.answer-row .chip,
.pool-row .chip { min-width: 56px; font: 500 1.5rem/1.2 var(--font-hanzi); }

/* Match: two columns, full-width column buttons. */
.match-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.5rem; align-items: start; }
.match-col { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.match-col .chip { width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.match-col.left .chip { justify-content: center; font: 500 1.5rem/1.2 var(--font-hanzi); }
.match-col.right .chip { justify-content: flex-start; font-family: var(--font-ui); font-size: var(--fs-base); }
.match-chip { position: relative; }
.match-chip.selected { border-color: var(--accent); background: var(--accent-wash); box-shadow: inset 0 0 0 2px var(--accent); }
.match-chip.matched { border-color: var(--match-color, var(--pair-1)); background: color-mix(in srgb, var(--match-color, var(--pair-1)) 14%, var(--surface)); box-shadow: inset 0 0 0 2px var(--match-color, var(--pair-1)); }
.match-chip.matched::after {
  content: attr(data-match);
  position: absolute;
  top: -0.45rem;
  right: -0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 999px;
  background: var(--match-color, var(--pair-1));
  color: var(--surface);
  font: 700 0.75rem/1 var(--font-ui);
}
.match-chip.ok { border-color: var(--ok); box-shadow: inset 0 0 0 2px var(--ok); }
.match-chip.bad { border-color: var(--danger); box-shadow: inset 0 0 0 2px var(--danger); }
.match-chip[data-match="1"] { --match-color: var(--pair-1); }
.match-chip[data-match="2"] { --match-color: var(--pair-2); }
.match-chip[data-match="3"] { --match-color: var(--pair-3); }
.match-chip[data-match="4"] { --match-color: var(--pair-4); }
.match-chip[data-match="5"] { --match-color: var(--pair-5); }
.match-chip[data-match="6"] { --match-color: var(--pair-6); }
.match-chip:disabled { opacity: 1; }
.match-answer { display: grid; gap: 0.35rem; padding-top: 0.5rem; border-top: 1px solid var(--line); color: var(--ink-soft); font-size: var(--fs-sm); }
.match-answer .ok { color: var(--ok); }
.match-answer .bad { color: var(--danger); }

/* Right / wrong. */
.feedback-box { display: grid; gap: 0.5rem; }
.feedback { margin: 0; padding: 0.6rem 0.8rem; border-radius: var(--r-md); font-weight: 700; }
.feedback.ok { background: var(--ok-wash); color: var(--ok); }
.feedback.bad { background: var(--danger-wash); color: var(--danger); }
.feedback.ok::before { content: "✓ " / ""; }
.feedback.bad::before { content: "✕ " / ""; }
`;

/** Inject the shared exercise CSS into <head> once. */
export function ensureExerciseStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = EXERCISE_UI_CSS;
  doc.head.append(style);
}
