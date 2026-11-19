/**
 * Extras hub. `#/extras` shows a menu of the areas; `#/extras/<area>` hands off
 * to that area's module.
 *
 * Contract for every src/extras/*.js module — same shape as a screen:
 *   export const titleKey = '...'            // i18n key, used as its menu label
 *   export function render(container, ctx)   // may return a cleanup function
 *
 * Menu cards: the first <span> is the title (`hubs.extras.<area>` when the
 * locale shard defines one, otherwise the module's own `titleKey`) and the
 * optional second <span class="muted"> is the one-line description
 * `hubs.extras.descriptions.<area>`. Both shards live in
 * src/locales/{en,es}.d/hubs.json.
 */
import { t, has } from '../i18n.js';
import { h, reset } from '../dom.js';

export const titleKey = 'screens.extras.more';

const HUB = 'extras';
const AREAS = [
  'profile',
  'stats',
  'paste',
  'draw',
  'pronounce',
  'settings',
  'backup',
  'worksheet',
  'anki',
  'account',
  'conversation',
];

const load = (area) => import(`../extras/${area}.js`);

/** Hanzi emblem per area (styles.css owns the old ones; the new areas get
 *  theirs here because that file is frozen). One line per area. */
const EMBLEMS = { worksheet: '纸', anki: '卡', account: '云', conversation: '聊' };
let emblemsAdded = false;
function addEmblems() {
  if (emblemsAdded || typeof document === 'undefined') return;
  emblemsAdded = true;
  const style = document.createElement('style');
  style.textContent = Object.entries(EMBLEMS)
    .map(([area, ch]) => `.menu > [data-area="${area}"].card.field::before { content: "${ch}" / ""; }`)
    .join('\n');
  document.head.append(style);
}

/** Menu label: `hubs.<HUB>.<area>` when the active locale defines it. */
const labelKey = (area, module) => (has(`hubs.${HUB}.${area}`) ? `hubs.${HUB}.${area}` : module.titleKey);

/** One-line menu description (only rendered when the locale defines it). */
const descriptionKey = (area) => `hubs.${HUB}.descriptions.${area}`;

export async function render(container, ctx) {
  const area = ctx?.route?.segments?.[0];
  if (AREAS.includes(area)) return (await load(area)).render(container, ctx);

  const modules = await Promise.all(AREAS.map((name) => load(name)));
  addEmblems();
  reset(container);
  container.append(
    h(
      'section',
      { class: 'menu', 'aria-label': t(titleKey) },
      ...modules.map((module, index) => {
        const name = AREAS[index];
        const description = descriptionKey(name);
        return h(
          'button',
          {
            type: 'button',
            class: 'card field',
            'data-area': name,
            onclick: () => ctx.navigate(`extras/${name}`),
          },
          h('span', { text: t(labelKey(name, module)) }),
          has(description) ? h('span', { class: 'muted', text: t(description) }) : null,
        );
      }),
    ),
  );
  container.focus({ preventScroll: true });
}
