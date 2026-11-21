/**
 * Learn hub. `#/learn` shows a menu of the areas; `#/learn/<area>` (and
 * `#/learn/<area>/<rest>`) hands off to that area's module.
 *
 * Contract for every src/learn/*.js module — same shape as a screen:
 *   export const titleKey = '...'            // i18n key, used as its menu label
 *   export function render(container, ctx)   // may return a cleanup function
 * `ctx` is the router context ({ route, navigate }); `route.segments` holds
 * everything after `learn/`, so an area can read its own sub-route.
 *
 * Menu cards: the first <span> is the title (`hubs.learn.<area>` when the
 * locale shard defines one, otherwise the module's own `titleKey`) and the
 * optional second <span class="muted"> is the one-line description
 * `hubs.learn.descriptions.<area>`. Both shards live in
 * src/locales/{en,es}.d/hubs.json.
 */
import { t, has } from '../i18n.js';
import { h, reset } from '../dom.js';

export const titleKey = 'screens.learn.title';

const HUB = 'learn';
const AREAS = [
  'lessons',
  'tones',
  'pinyin-chart',
  'strokes',
  'sentences',
  'dialogues',
  'themes',
  'dictation',
  'games',
  'radicals',
  'hardwords',
  'grammar',
  'plan',
  'exam',
  'typing',
];

const load = (area) => import(`../learn/${area}.js`);

/** Menu blocks, in reading order. Every area in AREAS appears exactly once.
 *  P2-1: kept to <= 4 tiles per block (chunking), so "Practice" is split. */
const GROUPS = [
  { key: 'start', areas: ['lessons', 'tones', 'pinyin-chart', 'strokes'] },
  { key: 'practice', areas: ['sentences', 'dialogues', 'themes', 'dictation'] },
  { key: 'more', areas: ['games', 'hardwords', 'radicals', 'typing'] },
  { key: 'deepen', areas: ['grammar', 'exam', 'plan'] },
];

/** Hanzi emblem per area (styles.css owns the old ones; the new areas get
 *  theirs here because that file is frozen). One line per area. */
const EMBLEMS = { plan: '计', exam: '考', typing: '打', dialogues: '话' };
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
  const byArea = new Map(AREAS.map((name, index) => [name, modules[index]]));
  addEmblems();
  reset(container);
  container.append(
    ...GROUPS.map((group) =>
      h(
        'section',
        { class: 'menu-group', 'aria-labelledby': `learn-group-${group.key}` },
        h('h2', { class: 'menu-group-title', id: `learn-group-${group.key}`, text: t(`hubs.${HUB}.groups.${group.key}`) }),
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
                onclick: () => ctx.navigate(`learn/${name}`),
              },
              h('span', { text: t(labelKey(name, module)) }),
              has(description) ? h('span', { class: 'muted', text: t(description) }) : null,
            );
          }),
        ),
      ),
    ),
  );
  container.focus({ preventScroll: true });
}
