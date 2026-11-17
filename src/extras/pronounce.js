/**
 * Pronunciation practice (stub). The owner task replaces this file (microphone
 * + src/speech.js); the hub only needs `titleKey` + `render(container, ctx)`.
 */
import { placeholder } from '../screens/placeholder.js';

export const titleKey = 'hubs.extras.pronounce';

export function render(container) {
  placeholder(container, titleKey, 'screens.extras.hint');
}
