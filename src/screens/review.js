/**
 * Review screen (phase 1 task): spaced-repetition queue (SM-2 / FSRS).
 * Contract: titleKey + render(container, ctx) — see src/main.js.
 */
import { placeholder } from './placeholder.js';

export const titleKey = 'screens.review.title';

export function render(container, ctx) {
  placeholder(container, titleKey, 'screens.review.hint', ctx);
}
