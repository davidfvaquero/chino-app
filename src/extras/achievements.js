/**
 * Achievements screen — #/extras/achievements
 *
 * A grid of the achievement definitions (public/data/achievements.json, reached
 * through src/gamification.js getStats): unlocked ones in jade, locked ones in
 * grey with the requirement they still need. A "N of M" counter sits above.
 * Unlocking a new one shows the shell toast (src/gamification-wire.js); locked
 * state never relies on colour alone (a "Locked" group heading + the
 * requirement text).
 *
 * Contract: `titleKey` + `render(container, ctx)` (see src/screens/extras.js).
 * No literal UI text: every string comes from t() (src/locales/{en,es}.d/
 * achievements.json and the shared gamification.ach.* keys).
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { getStats } from '../gamification.js';

export const titleKey = 'hubs.extras.achievements';

/** { unlocked, total } for the counter. Pure. */
export function achievementSummary(list = []) {
  const total = list.length;
  const unlocked = list.filter((a) => a?.unlocked).length;
  return { unlocked, total };
}

/** Presentation view of one definition: keys + state class. Pure. */
export function achievementView(def = {}) {
  const unlocked = !!def.unlocked;
  return {
    id: def.id,
    nameKey: def.nameKey,
    descKey: def.descKey,
    unlocked,
    className: unlocked ? 'unlocked' : 'locked',
  };
}

const STYLE_ID = 'achievements-style';
const CSS = `
.achievements-count { margin: 0 0 var(--gap); font-weight: 700; color: var(--ink-soft); }
.achievements-group-title { margin: var(--gap) 0 0.5rem; color: var(--ink-soft); font-size: var(--fs-sm); font-weight: 700; }
.achievements-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.5rem; }
.achievement-tile { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.7rem; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.achievement-tile[data-state="unlocked"] { border-color: var(--accent); background: var(--accent-wash); }
.achievement-tile[data-state="locked"] { border-color: var(--line); background: var(--inset); }
.achievement-tile .ach-title { font-weight: 700; color: var(--ink); }
.achievement-tile[data-state="locked"] .ach-title { color: var(--ink-soft); }
.achievement-tile .ach-req { font-size: var(--fs-sm); color: var(--ink-soft); line-height: 1.35; }
.achievement-tile .ach-date { font-size: 0.75rem; color: var(--ink-soft); }
.achievement-tile .ach-mark { color: var(--accent); font-weight: 700; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tile(def) {
  const view = achievementView(def);
  const node = h(
    'div',
    { class: 'achievement-tile', 'data-state': view.className, 'data-ach': view.id },
    h('span', { class: 'ach-mark', 'aria-hidden': 'true', text: view.unlocked ? '✓' : '' }),
    h('span', { class: 'ach-title', text: t(view.nameKey) }),
    h('span', { class: 'ach-req', text: t(view.descKey) }),
    view.unlocked && def.unlockedAt ? h('span', { class: 'ach-date', text: formatDate(def.unlockedAt) }) : null,
  );
  return node;
}

function group(titleKey, defs) {
  if (!defs.length) return null;
  return h(
    'section',
    {},
    h('h2', { class: 'achievements-group-title', text: t(titleKey) }),
    h('div', { class: 'achievements-list' }, ...defs.map(tile)),
  );
}

export async function render(container, ctx) {
  ensureStyles(document);
  let stats;
  try {
    stats = await getStats();
  } catch (err) {
    console.error('achievements screen', err);
    reset(container).append(h('p', { class: 'hint', text: t('achievements.locked') }));
    return;
  }
  const list = stats.achievements ?? [];
  const summary = achievementSummary(list);
  const unlocked = list.filter((a) => a.unlocked);
  const locked = list.filter((a) => !a.unlocked);
  reset(container);
  const root = h(
    'section',
    { class: 'screen achievements' },
    h('p', { class: 'achievements-count', 'data-role': 'count', text: t('achievements.count', { done: summary.unlocked, total: summary.total }) }),
    group('achievements.unlocked', unlocked),
    group('achievements.locked', locked),
  );
  container.append(root);
  container.dataset.state = summary.total ? 'ready' : 'empty';
  container.focus({ preventScroll: true });
}
