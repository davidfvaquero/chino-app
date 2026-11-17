/**
 * gamification-wire.js — connects screen events to gamification.record().
 * Listens on window for the six chino:* events and forwards them to gamification.record().
 * Import once from main.js (or any entry point that runs after gamification is available).
 */
import { record } from './gamification.js';
import gamification from './gamification.js';

const EVENT_MAP = {
  'chino:review_done': 'review_done',
  'chino:lesson_done': 'lesson_done',
  'chino:reading_done': 'reading_done',
  'chino:stroke_done': 'stroke_done',
  'chino:draw_used': 'draw_used',
  'chino:speak_done': 'speak_done',
};

function attach() {
  for (const [domEvent, gameEvent] of Object.entries(EVENT_MAP)) {
    window.addEventListener(domEvent, (e) => {
      const detail = e?.detail ?? {};
      record(gameEvent, detail).catch((err) => {
        console.warn('gamification record failed', gameEvent, err);
      });
    });
  }
}

// Auto-attach when imported in a browser environment (runs once)
if (typeof window !== 'undefined') {
  attach();
  // Expose for headless testing
  window.__gamification = gamification;
}

export { attach, EVENT_MAP };