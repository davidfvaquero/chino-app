/**
 * gamification-wire.js — connects screen events to gamification.record().
 * Listens on window for the six chino:* events and forwards them to gamification.record().
 * Import once from main.js (or any entry point that runs after gamification is available).
 */
import { record, EVENTS } from './gamification.js';
import gamification from './gamification.js';
import { t } from './i18n.js';
import { notice } from './notice.js';

/** DOM event `chino:<name>` for every gamification event; one source of truth. */
const EVENT_MAP = Object.fromEntries(Object.keys(EVENTS).map((name) => [`chino:${name}`, name]));

/** Announce each freshly unlocked achievement through the shell toast (reduced
 *  motion handled by styles.css; the toast sits above the tab bar). */
function announceUnlocked(unlocked) {
  for (const def of unlocked ?? []) notice('achievements.unlockedToast', { name: t(def.nameKey) });
}

function attach() {
  for (const [domEvent, gameEvent] of Object.entries(EVENT_MAP)) {
    window.addEventListener(domEvent, (e) => {
      const detail = e?.detail ?? {};
      record(gameEvent, detail)
        .then((result) => announceUnlocked(result?.unlocked))
        .catch((err) => {
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