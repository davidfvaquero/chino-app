/**
 * plan.js — guided 30-day beginner plan (HSK 1).
 *
 * Screen: `#/learn/plan`. Data: public/data/plan/hsk1-30d.json — every task is
 * a reference by id to an existing lesson / reading / theme / grammar pattern
 * (validated in tests/plan.test.mjs).
 *
 * Flow: "Start plan" stores the start day in the `progress` store; the screen
 * lists the 30 days with a status (done / today / pending), each task opens its
 * route, and a day is marked done with a manual button (or automatically when
 * every task of that day has fired its `chino:*` event). Behind schedule?
 * "Catch up" shifts the start day so today is the first unfinished day;
 * "Reset plan" clears everything.
 *
 * Public API (pure, clock injected where relevant):
 *   titleKey
 *   PLAN_PATH                                   // fetchData() path
 *   STORE / KEY                                 // progress storage slot
 *   dayIndex(date)                              // local whole days since epoch
 *   lessonLevel(id)                             // 'hsk1' | 'practical'
 *   taskRoute(task)                             // router path for a task
 *   taskLabelKey(type)                          // i18n key for a task type
 *   validatePlan(plan)                          // -> string[] problems
 *   loadPlan({fetchData})                       // -> plan (validated)
 *   currentDay(plan, progress, now)             // -> 1..N (1 when unstarted)
 *   firstUnfinished(plan, progress)             // -> day number | null
 *   dayStatus(day, today, completed)            // 'done' | 'today' | 'pending'
 *   computeDays(plan, progress, now)            // -> [{day, titleKey, status, rest}]
 *   isBehind(plan, progress, now)               // -> boolean
 *   getProgress({store}) / startPlan({store, now}) / resetPlan({store})
 *   markDayDone(day, {store}) / catchUp({store, now})
 *   render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { fetchData } from '../data-url.js';
import { loadIndex as loadLessonIndex } from './lessons.js';
import { loadIndex as loadThemeIndex } from './themes.js';
import { loadIndex as loadGrammarIndex } from './grammar.js';
import { loadIndex as loadReadingIndex } from '../reading/data.js';

export const titleKey = 'plan.title';
export const PLAN_PATH = 'plan/hsk1-30d.json';
export const STORE = 'progress';
export const KEY = 'plan:hsk1-30d';

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------- pure logic -- */

/** Whole local days since 1970-01-01 (stable across the local day). */
export function dayIndex(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** Lesson level from its id prefix ('practical-01' -> 'practical'). */
export function lessonLevel(id) {
  return String(id).startsWith('practical') ? 'practical' : 'hsk1';
}

/** Router path that opens a task's target. */
export function taskRoute(task) {
  const id = task?.id;
  switch (task?.type) {
    case 'lesson':
      return `learn/lessons/${id}${lessonLevel(id) === 'hsk1' ? '' : `?level=${lessonLevel(id)}`}`;
    case 'reading':
      return `read/${id}`;
    case 'theme':
      return `learn/themes/${id}`;
    case 'grammar':
      return `learn/grammar/${id}`;
    case 'review':
    default:
      return 'review';
  }
}

/** i18n key for a task type label (interpolated with the resolved title). */
export function taskLabelKey(type) {
  return `plan.task.${type}`;
}

/** Problems with a plan object (empty array = valid). */
export function validatePlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object') return ['plan is not an object'];
  if (!Array.isArray(plan.days) || plan.days.length === 0) return ['plan.days is not a non-empty array'];
  const seen = new Set();
  plan.days.forEach((entry, i) => {
    if (!Number.isInteger(entry?.day)) problems.push(`days[${i}].day missing`);
    else if (seen.has(entry.day)) problems.push(`days[${i}] duplicate day ${entry.day}`);
    else seen.add(entry.day);
    if (typeof entry?.titleKey !== 'string' || !entry.titleKey) problems.push(`days[${i}].titleKey missing`);
    if (!Array.isArray(entry?.tasks) || entry.tasks.length === 0) problems.push(`days[${i}].tasks is empty`);
    else {
      entry.tasks.forEach((task, j) => {
        if (typeof task?.type !== 'string') problems.push(`days[${i}].tasks[${j}].type missing`);
        if (task?.type !== 'review' && typeof task.id !== 'string') {
          problems.push(`days[${i}].tasks[${j}].id missing`);
        }
      });
    }
  });
  return problems;
}

/** Loads and validates the plan JSON (fetchData injectable for tests). */
export async function loadPlan({ fetchData: fetchImpl = fetchData } = {}) {
  const plan = await fetchImpl(PLAN_PATH);
  const problems = validatePlan(plan);
  if (problems.length) throw new Error(`plan: ${problems.join('; ')}`);
  return plan;
}

/** 1-based day of the plan for `now` (clamped to [1, total]; 1 if unstarted). */
export function currentDay(plan, progress, now = new Date()) {
  const total = plan?.days?.length ?? 0;
  if (!total || !progress || !Number.isInteger(progress.startDay)) return 1;
  const day = dayIndex(now) - progress.startDay + 1;
  return Math.min(Math.max(day, 1), total);
}

/** Smallest day number not yet completed, or null when every day is done. */
export function firstUnfinished(plan, progress) {
  const done = new Set(progress?.completed ?? []);
  for (const entry of plan?.days ?? []) if (!done.has(entry.day)) return entry.day;
  return null;
}

/** 'done' (completed), 'today' (the current day) or 'pending'. */
export function dayStatus(day, today, completed = []) {
  if (completed.includes(day)) return 'done';
  return day === today ? 'today' : 'pending';
}

/** Per-day view models for the list: {day, titleKey, status, rest}. */
export function computeDays(plan, progress, now = new Date()) {
  const today = currentDay(plan, progress, now);
  const completed = progress?.completed ?? [];
  return (plan?.days ?? []).map((entry) => ({
    day: entry.day,
    titleKey: entry.titleKey,
    rest: Boolean(entry.rest),
    status: dayStatus(entry.day, today, completed),
  }));
}

/** True when the user has fallen behind (today is past the first unfinished day). */
export function isBehind(plan, progress, now = new Date()) {
  const first = firstUnfinished(plan, progress);
  if (first == null) return false;
  return currentDay(plan, progress, now) > first;
}

/* -------------------------------------------------------------- progress --- */

const clone = (value) => (value ? { startDay: value.startDay, completed: [...(value.completed ?? [])] } : null);

/** Stored progress {startDay, completed[]}, or null when the plan is unstarted. */
export async function getProgress({ store = storage } = {}) {
  const value = await store.get(STORE, KEY);
  return value && Number.isInteger(value.startDay) ? clone(value) : null;
}

/** Starts (or restarts) the plan today. */
export async function startPlan({ store = storage, now = new Date() } = {}) {
  const progress = { startDay: dayIndex(now), completed: [] };
  await store.set(STORE, KEY, progress);
  return progress;
}

/** Clears the plan (start date + completed days). */
export async function resetPlan({ store = storage } = {}) {
  await store.delete(STORE, KEY);
  return null;
}

/** Marks one day as done (idempotent). Returns the updated progress. */
export async function markDayDone(day, { store = storage } = {}) {
  const progress = (await getProgress({ store })) ?? { startDay: dayIndex(), completed: [] };
  if (!progress.completed.includes(day)) progress.completed.push(day);
  progress.completed.sort((a, b) => a - b);
  await store.set(STORE, KEY, progress);
  return progress;
}

/** Shifts the start day so today becomes the first unfinished day. */
export async function catchUp({ store = storage, now = new Date(), plan = null } = {}) {
  const progress = await getProgress({ store });
  if (!progress) return null;
  const loaded = plan ?? (await loadPlan().catch(() => null));
  const first = loaded ? firstUnfinished(loaded, progress) : null;
  if (first == null) return progress;
  progress.startDay = dayIndex(now) - (first - 1);
  await store.set(STORE, KEY, progress);
  return progress;
}

/* ----------------------------------------------------------------- style --- */

const STYLE_ID = 'plan-style';
const CSS = `
.plan { display: grid; gap: 0.75rem; }
.plan-head { display: grid; gap: 0.4rem; }
.plan-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.plan-progress { color: var(--ink-soft); margin: 0; }
.plan-days { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.plan-day { padding: 0.6rem 0.75rem; }
.plan-day > summary { cursor: pointer; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; min-height: 2.75rem; }
.plan-day .plan-n { color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.plan-badge { margin-left: auto; font-size: 0.72rem; border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.5rem; color: var(--ink-soft); }
.plan-day[data-status="today"] .plan-badge { border-color: var(--accent); color: var(--accent); }
.plan-day[data-status="done"] .plan-badge { color: var(--accent); }
.plan-tasks { display: flex; flex-direction: column; gap: 0.4rem; margin: 0.6rem 0 0; padding: 0; list-style: none; }
.plan-task { min-height: 44px; text-align: left; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: inherit; font: inherit; cursor: pointer; padding: 0.5rem 0.7rem; }
.plan-rest { color: var(--ink-soft); margin: 0.6rem 0 0; }
`;

function ensureStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/* ---------------------------------------------------------------- render --- */

const safe = (promise, fallback) => Promise.resolve(promise).catch(() => fallback);

/** id -> title maps from the existing content indexes (best-effort labels). */
async function titleMaps() {
  const [hsk1, practical, readings, themes, grammar] = await Promise.all([
    safe(loadLessonIndex('hsk1'), null),
    safe(loadLessonIndex('practical'), null),
    safe(loadReadingIndex(), []),
    safe(loadThemeIndex(), []),
    safe(loadGrammarIndex(), []),
  ]);
  const lessons = new Map();
  for (const index of [hsk1, practical]) for (const l of index?.lessons ?? []) lessons.set(l.id, l.title);
  const byId = (list, out) => {
    for (const item of list ?? []) if (item?.id) out.set(item.id, item.title);
    return out;
  };
  return {
    lesson: lessons,
    reading: byId(readings, new Map()),
    theme: byId(themes, new Map()),
    grammar: byId(grammar, new Map()),
  };
}

/** Human label for a task: t('plan.task.<type>', {title|n}). */
function taskText(task, maps) {
  const key = taskLabelKey(task.type);
  if (task.type === 'review') return t(key, { n: task.cards ?? 0 });
  const title = maps?.[task.type]?.get(task.id) ?? task.id;
  return t(key, { title });
}

function dayCard(entry, view, maps, ctx, onDone) {
  const status = t(`plan.status.${view.status}`);
  const summary = h(
    'summary',
    {},
    h('span', { class: 'plan-n', text: t('plan.day', { n: view.day }) }),
    h('span', { text: t(view.titleKey) }),
    h('span', { class: 'plan-badge', 'data-status': view.status, text: status }),
  );
  const details = h('details', {
    class: 'card plan-day',
    'data-day': String(view.day),
    'data-status': view.status,
    open: view.status === 'today' ? true : undefined,
  });
  details.append(summary);

  if (view.rest) details.append(h('p', { class: 'plan-rest', text: t('plan.rest') }));

  const list = h('ul', { class: 'plan-tasks' });
  for (const task of entry.tasks) {
    list.append(
      h('li', {}, h('button', {
        type: 'button',
        class: 'plan-task',
        'data-route': taskRoute(task),
        text: taskText(task, maps),
        onclick: () => ctx.navigate(taskRoute(task)),
      })),
    );
  }
  details.append(list);

  if (view.status !== 'done') {
    details.append(h('button', {
      type: 'button',
      class: 'btn',
      text: t('plan.markDone'),
      onclick: async (event) => {
        event.currentTarget.disabled = true;
        await onDone(view.day);
      },
    }));
  }
  return details;
}

export async function render(container, ctx = {}) {
  ensureStyles();
  const go = (path) => (typeof ctx.navigate === 'function' ? ctx.navigate(path) : (location.hash = `#/${path}`));
  reset(container).append(h('p', { class: 'plan-progress', text: t('common.loading') }));

  let plan;
  let progress;
  try {
    [plan, progress] = await Promise.all([loadPlan(), getProgress()]);
  } catch (err) {
    console.error('plan screen', err);
    reset(container).append(h('p', { class: 'plan-progress', text: t('plan.loadError') }));
    return;
  }

  const draw = async () => {
    const now = new Date();
    const days = computeDays(plan, progress, now);
    const doneCount = days.filter((d) => d.status === 'done').length;
    const maps = await titleMaps();

    const head = h('div', { class: 'plan-head' }, h('p', { class: 'plan-progress', text: t('plan.intro') }));

    if (!progress) {
      head.append(h('button', {
        type: 'button',
        class: 'btn primary',
        text: t('plan.start'),
        onclick: async () => {
          progress = await startPlan();
          await draw();
        },
      }));
    } else {
      head.append(
        h('p', { class: 'plan-progress', text: t('plan.progress', { done: doneCount, total: days.length }) }),
        h(
          'div',
          { class: 'plan-actions' },
          isBehind(plan, progress, now)
            ? h('button', {
                type: 'button',
                class: 'btn',
                text: t('plan.catchUp'),
                onclick: async () => {
                  progress = await catchUp({ plan });
                  await draw();
                },
              })
            : null,
          h('button', {
            type: 'button',
            class: 'btn',
            text: t('plan.reset'),
            onclick: async () => {
              progress = await resetPlan();
              await draw();
            },
          }),
        ),
      );
    }

    const onDone = async (day) => {
      progress = await markDayDone(day);
      await draw();
    };

    const list = h('ul', { class: 'plan-days' });
    for (const entry of plan.days) {
      const view = days.find((d) => d.day === entry.day);
      list.append(h('li', {}, dayCard(entry, view, maps, { navigate: go }, onDone)));
    }

    reset(container).append(h('section', { class: 'plan' }, head, list));
    container.focus?.({ preventScroll: true });
  };

  await draw();
}
