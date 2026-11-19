/**
 * Games hub — `#/learn/games` shows a menu of short memory games.
 *
 * Contract for every src/learn/games/*.js module — same shape as a screen:
 *   export const titleKey = '...'            // i18n key, used as its menu label
 *   export function render(container, ctx)   // may return a cleanup function
 * `ctx` is the router context ({ route, navigate }); `route.segments` holds
 * everything after `learn/games/`, so a game can read its own sub-route.
 *
 * Pure, browser-free helpers (covered by tests/games.test.mjs):
 *   generateMatchingRound(words, { count, mode }) -> { pairs, distractors }
 *   generateMemoryRound(words, { count }) -> { cards }
 *   checkMatching(pairs, response) -> { correct, score, matched, total }
 *   checkMemory(cards, flips) -> { correct, score, matched, total, complete }
 *
 * Wiring with the rest of the app:
 *   - dictionary: search() for word source (HSK1, review deck, theme)
 *   - audio: speak() for pronunciation
 *   - window event `chino:lesson_done`, detail: { gameId, score, total, timeMs, mistakes }
 *   - pinyinHtml() from src/tone.js for display
 */

import { t, has } from '../i18n.js';
import { h, reset } from '../dom.js';

export const titleKey = 'hubs.learn.games';

export const GAMES = [];

/** Register a game module so it appears in the hub menu. */
export function registerGame(module) {
  if (!module || typeof module.render !== 'function' || !module.titleKey) {
    throw new TypeError('games: module must have titleKey and render');
  }
  const id = module.id ?? module.titleKey.replace(/^games\\./, '');
  GAMES.push({ id, titleKey: module.titleKey, load: () => Promise.resolve(module) });
  return id;
}

/** Load all registered games (for the hub menu). */
export async function loadGames() {
  const loaded = await Promise.all(GAMES.map((g) => g.load()));
  return loaded;
}

/** Get a game module by id. */
export async function getGame(id) {
  const entry = GAMES.find((g) => g.id === id);
  if (!entry) return null;
  return entry.load();
}

/** Register built-in games (called once at module load). */
let registrationPromise = null;
export async function ensureGamesRegistered() {
  if (registrationPromise) return registrationPromise;
  registrationPromise = (async () => {
    const base = new URL('./games/', import.meta.url);
    const [matching, memory, timed, builder] = await Promise.all([
      import(`${base}matching.js`),
      import(`${base}memory.js`),
      import(`${base}timed.js`),
      import(`${base}builder.js`),
    ]);
    registerGame(matching);
    registerGame(memory);
    registerGame(timed);
    registerGame(builder);
  })();
  return registrationPromise;
}

// Auto-register when imported
ensureGamesRegistered();

/* ------------------------------------------------------------------ render -- */

const STYLE_ID = 'games-hub-style';

const CSS = `
.games-hub { display: flex; flex-direction: column; gap: 0.75rem; }
.games-hub .game-title { font-size: 1.1rem; font-weight: 500; }
.games-hub .game-desc { font-size: 0.85rem; opacity: 0.7; margin-top: 0.25rem; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Screen entry point: shows the games menu or delegates to a specific game. */
export async function render(container, ctx) {
  ensureStyles(document);
  await ensureGamesRegistered();

  const segments = ctx?.route?.segments ?? [];
  const isHub = segments[0] === 'games';
  const gameId = isHub ? segments[1] : segments[0];

  // If a specific game is requested, delegate to it
  if (gameId) {
    const game = await getGame(gameId);
    if (game) return game.render(container, { ...ctx, route: { ...ctx.route, segments: isHub ? segments.slice(1) : segments } });
  }

  // Otherwise show the games menu
  reset(container);
  const games = await loadGames();

  const section = h(
    'section',
    { class: 'games-hub', 'aria-label': t(titleKey) },
    h('h2', { text: t(titleKey) }),
    h(
      'div',
      { class: 'menu' },
      ...games.map((game) => {
        const descKey = `${game.titleKey}.desc`;
        return h(
          'button',
          {
            type: 'button',
            class: 'card field',
            'data-game': game.id,
            onclick: () => ctx.navigate(`learn/games/${game.id}`),
          },
          h('div', {},
            h('span', { class: 'game-title', text: t(game.titleKey) }),
            has(descKey) ? h('span', { class: 'game-desc', text: t(descKey) }) : null,
          ),
        );
      }),
    ),
  );
  container.append(section);
  container.focus({ preventScroll: true });
}