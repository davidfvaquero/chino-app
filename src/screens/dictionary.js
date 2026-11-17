/**
 * Dictionary screen (phase 1 task): search CC-CEDICT by hanzi/pinyin/English.
 * Contract: titleKey + render(container, ctx) — see src/main.js.
 */
import { placeholder } from './placeholder.js';

export const titleKey = 'screens.dictionary.title';

export function render(container, ctx) {
  placeholder(container, titleKey, 'screens.dictionary.hint', ctx);
}
