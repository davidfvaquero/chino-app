/**
 * exercise-ui.css.js — shared mobile styles for lesson/game exercise controls.
 *
 * Injected once per document. src/styles.css is owned by another task, so the
 * base `.btn` / `.chip` styles live here and are reused by lessons, tones,
 * dictation and exam. Rules are mobile-first and reuse the shell CSS variables
 * so light/dark and the font scale keep working.
 */

const STYLE_ID = 'exercise-ui-style';

export const EXERCISE_UI_CSS = `
/* Base button: 48px touch target, theme colours, no 300ms tap delay. */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 48px;
  padding: 0.65rem 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.15s, background 0.15s, transform 0.05s;
}
.btn:active { transform: scale(0.98); }
.btn.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn.option { width: 100%; justify-content: flex-start; text-align: left; font-weight: 500; }

/* Stacked options (choose / listen / dictation). */
.options { display: grid; gap: 0.5rem; }
.options .btn { width: 100%; }

/* Exercise shell. */
.exercise-body { display: grid; gap: 0.75rem; }
.exercise-body .prompt { margin: 0; color: var(--fg); font-size: 1rem; line-height: 1.4; }
.exercise-body .hint { margin: 0; color: var(--fg-soft); font-size: 0.9rem; line-height: 1.4; }
.exercise-body > .btn,
.exercise-body .feedback-box > .btn { width: 100%; }

/* Order chips. */
.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  min-width: 48px;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 1.05rem;
  line-height: 1.25;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.15s, background 0.15s, transform 0.05s;
}
.chip:active { transform: scale(0.98); }
.chip:disabled { opacity: 0.55; cursor: not-allowed; }
.answer-row,
.pool-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0.5rem;
  border: 1px dashed var(--line);
  border-radius: var(--radius);
  background: var(--bg-soft);
}

/* Match: two columns, full-width column buttons. */
.match-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
  align-items: start;
}
.match-col { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.match-col .chip {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  overflow-wrap: anywhere;
  white-space: normal;
}
.match-col.left .chip { justify-content: center; font-size: 1.5em; }
.match-col.right .chip { font-size: 1rem; }

/* Selection + pairing states. */
.match-chip { position: relative; }
.match-chip.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  box-shadow: inset 0 0 0 2px var(--accent);
}
.match-chip.matched {
  border-color: var(--match-color, #2e7d32);
  background: color-mix(in srgb, var(--match-color, #2e7d32) 14%, var(--bg));
  box-shadow: inset 0 0 0 2px var(--match-color, #2e7d32);
}
.match-chip.matched::after {
  content: attr(data-match);
  position: absolute;
  top: -0.45rem;
  right: -0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: var(--match-color, #2e7d32);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}
.match-chip.ok { border-color: #2e7d32; box-shadow: inset 0 0 0 2px #2e7d32; }
.match-chip.bad { border-color: #c62828; box-shadow: inset 0 0 0 2px #c62828; }

/* Per-pair colours; dark theme uses lighter borders. */
.match-chip[data-match="1"] { --match-color: #2e7d32; }
.match-chip[data-match="2"] { --match-color: #1565c0; }
.match-chip[data-match="3"] { --match-color: #6a1b9a; }
.match-chip[data-match="4"] { --match-color: #ef6c00; }
.match-chip[data-match="5"] { --match-color: #00838f; }
.match-chip[data-match="6"] { --match-color: #ad1457; }

.match-answer {
  display: grid;
  gap: 0.35rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--line);
  font-size: 0.9rem;
  color: var(--fg-soft);
}
.match-answer .ok { color: #2e7d32; }
.match-answer .bad { color: #c62828; }

.feedback-box { display: grid; gap: 0.5rem; }
.feedback.ok { color: #2e7d32; font-weight: 600; }
.feedback.bad { color: #c62828; font-weight: 600; }

@media (prefers-color-scheme: dark) {
  .match-chip[data-match="1"] { --match-color: #81c784; }
  .match-chip[data-match="2"] { --match-color: #64b5f6; }
  .match-chip[data-match="3"] { --match-color: #ce93d8; }
  .match-chip[data-match="4"] { --match-color: #ffb74d; }
  .match-chip[data-match="5"] { --match-color: #4dd0e1; }
  .match-chip[data-match="6"] { --match-color: #f06292; }
  .match-chip.ok { border-color: #81c784; box-shadow: inset 0 0 0 2px #81c784; }
  .match-chip.bad { border-color: #ef5350; box-shadow: inset 0 0 0 2px #ef5350; }
  .match-answer .ok,
  .feedback.ok { color: #81c784; }
  .match-answer .bad,
  .feedback.bad { color: #ef5350; }
}

@media (prefers-reduced-motion: reduce) {
  .btn,
  .chip { transition: none; }
  .btn:active,
  .chip:active { transform: none; }
}
`;

/** Inject the shared exercise CSS into <head> once. */
export function ensureExerciseStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = EXERCISE_UI_CSS;
  doc.head.append(style);
}
