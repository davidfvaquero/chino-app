/**
 * Read screen (phase 3 task): graded readings with tap-a-word lookup.
 * Contract: titleKey + render(container, ctx) — see src/main.js.
 */
import { placeholder } from './placeholder.js';

export const titleKey = 'screens.read.title';

export function render(container, ctx) {
  placeholder(container, titleKey, 'screens.read.hint', ctx);
}
