/**
 * Learn screen (phase 2 task): HSK lessons, tones, stroke order, phrases.
 * Contract: titleKey + render(container, ctx) — see src/main.js.
 */
import { placeholder } from './placeholder.js';

export const titleKey = 'screens.learn.title';

export function render(container, ctx) {
  placeholder(container, titleKey, 'screens.learn.hint', ctx);
}
