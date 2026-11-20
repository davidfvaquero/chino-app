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

/** Menu blocks, in reading order. Every area in AREAS appears exactly once. */
const GROUPS = [
  { key: 'account', areas: ['profile', 'stats', 'account', 'backup'] },
  { key: 'tools', areas: ['paste', 'draw', 'pronounce', 'worksheet', 'anki', 'conversation'] },
  { key: 'about', areas: ['settings'] },
];

/** Hanzi emblem per area (styles.css owns the old ones; the new areas get
 *  theirs here). One line per area. */
const EMBLEMS = { worksheet: '纸', anki: '卡', account: '云', conversation: '聊' };
let emblemsAdded = false;
function addEmblems() {
  if (emblemsAdded || typeof document === 'undefined') return;
  emblemsAdded = true;
  const style = document.createElement('style');
  style.textContent = `${Object.entries(EMBLEMS)
    .map(([area, ch]) => `.menu > [data-area="${area}"].card.field::before { content: "${ch}" / ""; }`)
    .join('\n')}\n.menu-disclosure > summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; gap: 0.4rem; }\n.menu-disclosure > summary::after { content: ""; width: 0.5rem; height: 0.5rem; border: solid var(--ink-soft); border-width: 2px 2px 0 0; transform: rotate(45deg); }\n.menu-disclosure[open] > summary::after { transform: rotate(135deg); }`;
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
  const byArea = new Map(AREAS.map((name, index) => [name, modules[index]]));
  addEmblems();
  reset(container);

  const menuOf = (group) =>
    h(
      'div',
      { class: 'menu' },
      ...group.areas.map((name) => {
        const module = byArea.get(name);
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
    );

  container.append(
    ...GROUPS.map((group) => {
      const title = t(`hubs.${HUB}.groups.${group.key}`);
      // P2-2: the six "Tools" tiles are folded so "Help and about" stays in
      // the first screen instead of 13 tiles stacked open.
      if (group.key === 'tools') {
        return h(
          'details',
          { class: 'menu-group menu-disclosure' },
          h('summary', { class: 'menu-group-title', text: title }),
          menuOf(group),
        );
      }
      return h(
        'section',
        { class: 'menu-group', 'aria-labelledby': `extras-group-${group.key}` },
        h('h2', { class: 'menu-group-title', id: `extras-group-${group.key}`, text: title }),
        menuOf(group),
      );
    }),
  );
  container.focus({ preventScroll: true });
}
