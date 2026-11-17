/**
 * Learn hub. `#/learn` shows a menu of the four areas; `#/learn/<area>` (and
 * `#/learn/<area>/<rest>`) hands off to that area's module.
 *
 * Contract for every src/learn/*.js module — same shape as a screen:
 *   export const titleKey = '...'            // i18n key, used as its menu label
 *   export function render(container, ctx)   // may return a cleanup function
 * `ctx` is the router context ({ route, navigate }); `route.segments` holds
 * everything after `learn/`, so an area can read its own sub-route.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';

export const titleKey = 'screens.learn.title';

const AREAS = ['lessons', 'tones', 'strokes', 'sentences'];

const load = (area) => import(`../learn/${area}.js`);

export async function render(container, ctx) {
  const area = ctx?.route?.segments?.[0];
  if (AREAS.includes(area)) return (await load(area)).render(container, ctx);

  const modules = await Promise.all(AREAS.map((name) => load(name)));
  reset(container);
  container.append(
    h(
      'section',
      { class: 'menu', 'aria-label': t(titleKey) },
      ...modules.map((module, index) =>
        h(
          'button',
          {
            type: 'button',
            class: 'card field',
            'data-area': AREAS[index],
            onclick: () => ctx.navigate(`learn/${AREAS[index]}`),
          },
          h('span', { text: t(module.titleKey) }),
        ),
      ),
    ),
  );
  container.focus({ preventScroll: true });
}
