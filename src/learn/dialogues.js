/**
 * dialogues.js — short everyday dialogues (Learn hub area).
 *
 * Screen: `#/learn/dialogues` lists the dialogues (filtered by HSK level),
 * `#/learn/dialogues/<id>` opens one. A dialogue is a two-person conversation
 * shown as A/B bubbles with pinyin (respects the global pinyin switch) and a
 * translation you can show or hide, per-line audio, "play all" (alternating
 * A/B), two practice modes ("You are B" and "Order the dialogue"), an
 * "add words to review" button and a "mark as done" flag in `progress`.
 *
 * Data: public/data/dialogues/index.json + dialogue-NN.json
 * (docs/dialogue-schema.md). Language-aware (es copy under data/es/dialogues/).
 *
 * Public API:
 *   titleKey                             // i18n key for the hub menu label
 *   LEVELS / DEFAULT_LEVEL
 *   loadIndex({base, fetchJson})         -> [{id, title, titleEn, topic, level}]
 *   loadDialogue(id, {…})                -> normalized dialogue
 *   filterByLevel(index, level)          -> entries of that level
 *   shuffle / orderRound / isOrdered     // pure, "Order the dialogue"
 *   buildChoice / choiceRounds / isCorrectChoice  // pure, "You are B"
 *   addDialogueToReview(dialogue, {…})   // -> {added, total}
 *   doneKey / getDone / markDone         // progress + 'chino:dialogue_done'
 *   render(container, ctx)
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { speak } from '../audio.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { pinyinToggle } from '../settings.js';
import { fetchData } from '../data-url.js';
import { segment, lookup as dictLookup } from '../dictionary.js';
import { reviewEntryFrom } from '../reading/model.js';

export const titleKey = 'dialogues.title';
export const LEVELS = ['hsk1', 'hsk2', 'hsk3'];
export const DEFAULT_LEVEL = 'hsk1';
export const PROGRESS_STORE = 'progress';
export const DATA_BASE = new URL('../../data/dialogues/', import.meta.url);

const HANZI_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const str = (v) => (typeof v === 'string' ? v : '');

/* ----------------------------------------------------------- pure logic -- */

/** A selectable level name, or the default when unknown. */
export function normalizeLevel(level) {
  return LEVELS.includes(level) ? level : DEFAULT_LEVEL;
}

/** Coerce the raw index into fully-populated entries. */
export function normalizeIndex(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.dialogues) ? raw.dialogues : [];
  return list.map((entry) => ({
    id: str(entry?.id),
    title: str(entry?.title),
    titleEn: str(entry?.titleEn),
    topic: str(entry?.topic),
    level: normalizeLevel(entry?.level),
  }));
}

/** Index entries of one level (the list filter). */
export function filterByLevel(index, level) {
  const wanted = normalizeLevel(level);
  return (Array.isArray(index) ? index : []).filter((entry) => entry.level === wanted);
}

/** Coerce a raw dialogue JSON into a fully-populated object (missing = ""). */
export function normalizeDialogue(raw = {}) {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    id: str(raw.id),
    title: str(raw.title),
    titleEn: str(raw.titleEn),
    topic: str(raw.topic),
    level: normalizeLevel(raw.level),
    lines: lines.map((line) => ({
      speaker: str(line?.speaker),
      zh: str(line?.zh),
      pinyin: str(line?.pinyin),
      en: str(line?.en),
    })),
  };
}

/** Fisher–Yates shuffle; `rng` is injected so tests stay deterministic. */
export function shuffle(items, rng = Math.random) {
  const out = [...(Array.isArray(items) ? items : [])];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Indices of the B turns (the ones the student answers in "You are B"). */
export function bLineIndices(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, i) => (line?.speaker === 'B' ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * One "You are B" round for line `index` (a B turn): the reply plus two
 * distractors taken from other lines, shuffled. Pure — no DOM.
 */
export function buildChoice(lines, index, rng = Math.random) {
  const list = Array.isArray(lines) ? lines : [];
  const answer = str(list[index]?.zh);
  const pool = [
    ...new Set(list.filter((_, i) => i !== index).map((line) => str(line?.zh)).filter((zh) => zh && zh !== answer)),
  ];
  const options = shuffle([answer, ...shuffle(pool, rng).slice(0, 2)], rng).map((zh) => ({
    zh,
    correct: zh === answer,
  }));
  return { index, prompt: list[index - 1] ?? null, answer, options };
}

/** Every B turn as a round, in order. */
export function choiceRounds(lines, rng = Math.random) {
  return bLineIndices(lines).map((index) => buildChoice(lines, index, rng));
}

/** Was that option the real reply? */
export function isCorrectChoice(option) {
  return Boolean(option && option.correct);
}

/** "Order the dialogue": the shuffled items plus the solution to compare with. */
export function orderRound(lines, rng = Math.random) {
  const solution = (Array.isArray(lines) ? lines : []).map((line) => ({ ...line }));
  return { items: shuffle(solution, rng), solution };
}

/** Is `items` back in the original speaking order? */
export function isOrdered(items, solution) {
  if (!Array.isArray(items) || !Array.isArray(solution) || items.length !== solution.length) return false;
  return items.every(
    (line, i) =>
      line && solution[i] && str(line.zh) === str(solution[i].zh) && str(line.speaker) === str(solution[i].speaker),
  );
}

/* ------------------------------------------------------------- data I/O -- */

const readJson = (relPath, { base = DATA_BASE, fetchJson } = {}) =>
  fetchJson ? fetchJson(new URL(relPath, base)) : fetchData(`dialogues/${relPath}`);

/** Index of available dialogues (one flat list; filter with filterByLevel). */
export async function loadIndex(opts = {}) {
  return normalizeIndex(await readJson('index.json', opts));
}

/** One dialogue by id (the index id doubles as the file name). */
export async function loadDialogue(id, opts = {}) {
  return normalizeDialogue(await readJson(`${id}.json`, opts));
}

/* -------------------------------------------------------- add to review -- */

/**
 * Segments every line and sends each distinct word to the review deck.
 * Reuses dictionary.segment/lookup + srs.addToReview (same path as the
 * readings). `add`, `lookup` and `segmentFn` are injectable for tests.
 */
export async function addDialogueToReview(dialogue, { add = addToReview, lookup, segmentFn = segment } = {}) {
  const words = new Set();
  for (const line of dialogue?.lines ?? []) {
    for (const token of await segmentFn(line.zh)) {
      if (HANZI_RE.test(token)) words.add(token);
    }
  }
  let added = 0;
  for (const word of words) {
    const entry = lookup ? await lookup(word) : await dictLookup(word, { spanish: getLocale() === 'es' });
    const res = await add(entry ? reviewEntryFrom(entry, 'dialogue') : { hanzi: word, source: 'dialogue' });
    if (res?.created) added += 1;
  }
  return { added, total: words.size };
}

/* ------------------------------------------------------------- progress -- */

export function doneKey(id) {
  return `dialogue:${id}`;
}

export async function getDone(id, { store = storage } = {}) {
  return (await store.get(PROGRESS_STORE, doneKey(id))) ?? null;
}

export async function markDone(dialogue, { store = storage, now = Date.now() } = {}) {
  const record = {
    dialogueId: dialogue.id,
    title: dialogue.title,
    lines: dialogue.lines.length,
    doneAt: now,
  };
  await store.set(PROGRESS_STORE, doneKey(dialogue.id), { ...(await getDone(dialogue.id, { store })), ...record });
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    try {
      window.dispatchEvent(
        new CustomEvent('chino:dialogue_done', {
          detail: { id: dialogue.id, title: dialogue.title, level: dialogue.level },
        }),
      );
    } catch {
      /* older engines without CustomEvent: the progress flag is enough */
    }
  }
  return record;
}

/* ----------------------------------------------------------------- style -- */

const STYLE_ID = 'dialogues-style';
const CSS = `
.dlg-list { display: grid; gap: 0.625rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dlg-tile { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.85rem; text-align: left; }
.dlg-tile .dlg-tile-title { font-weight: 600; font-size: var(--fs-md); }
.dlg-tile .dlg-tile-en { color: var(--ink-soft); font-size: var(--fs-sm); }
.dlg-tile .dlg-tile-topic { color: var(--ink-soft); font-size: var(--fs-sm); }
.dlg-tile[aria-disabled="true"] { opacity: 0.7; }
.dlg-head { display: flex; flex-direction: column; gap: 0.5rem; }
.dlg-head h2 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
.dlg-head .dlg-sub { color: var(--ink-soft); margin: 0; }
.dlg-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.dlg-actions > * { flex: 1 1 auto; }
.dlg-modes { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.dlg-modes .chip { flex: 1 1 auto; min-height: 44px; font-size: var(--fs-sm); font-weight: 600; }
.dlg-thread { display: grid; gap: 0.5rem; }
.dlg-bubble { display: grid; gap: 0.2rem; max-width: 88%; padding: 0.6rem 0.8rem; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.dlg-bubble[data-speaker="A"] { justify-self: start; border-start-start-radius: 4px; }
.dlg-bubble[data-speaker="B"] { justify-self: end; border-start-end-radius: 4px; background: var(--inset); }
.dlg-bubble .dlg-speaker { font-size: 0.8125rem; font-weight: 700; color: var(--ink-soft); }
.dlg-zh { min-height: 44px; display: flex; align-items: center; width: 100%; padding: 0.15rem 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 1.5rem; line-height: 1.3; text-align: inherit; cursor: pointer; }
.dlg-bubble .pinyin { margin: 0; font-size: var(--fs-base); }
.dlg-en { margin: 0; color: var(--ink-soft); font-size: var(--fs-sm); }
.dlg-round { display: grid; gap: 0.5rem; padding: 0.75rem; }
.dlg-round .dlg-context { margin: 0; color: var(--ink-soft); font-size: var(--fs-sm); }
.dlg-result { font-weight: 600; }
.dlg-result[data-ok="true"] { color: var(--ok, var(--accent)); }
.dlg-result[data-ok="false"] { color: var(--danger); }
.dlg-order-slots, .dlg-order-pool { display: flex; flex-direction: column; gap: 0.4rem; }
.dlg-order-pool { flex-direction: row; flex-wrap: wrap; }
.dlg-order-pool > .btn { width: auto; flex: 0 1 auto; }
@media (min-width: 40rem) { .dlg-wrap { max-width: 42rem; } }
`;

function ensureStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/* ---------------------------------------------------------------- render -- */

export async function render(container, ctx) {
  ensureStyles();
  const id = ctx?.route?.segments?.[1];
  if (id) return renderDialogue(container, ctx, id);
  return renderList(container, ctx);
}

const levelOf = (ctx) => normalizeLevel(ctx?.route?.params?.level);
const listPath = (level) => (level === DEFAULT_LEVEL ? 'learn/dialogues' : `learn/dialogues?level=${level}`);

function backButton(ctx) {
  return h('button', {
    type: 'button',
    class: 'btn ghost sm',
    'data-action': 'back',
    text: t('dialogues.back'),
    onclick: () => ctx.navigate('learn/dialogues'),
  });
}

async function renderList(container, ctx) {
  const level = levelOf(ctx);
  reset(container);
  const picker = h(
    'div',
    { class: 'level-picker', role: 'group', 'aria-label': t('dialogues.levelLabel') },
    ...LEVELS.map((name) =>
      h('button', {
        type: 'button',
        class: 'btn option',
        'data-level': name,
        'aria-pressed': String(name === level),
        text: t(`dialogues.level.${name}`),
        onclick: () => ctx.navigate(listPath(name)),
      }),
    ),
  );
  const wrap = h('div', { class: 'dlg-wrap' }, picker, h('p', { class: 'hint', text: t('dialogues.listIntro') }));
  container.append(wrap);
  try {
    const entries = filterByLevel(await loadIndex(), level);
    if (!entries.length) {
      wrap.append(h('p', { class: 'muted', text: t('dialogues.empty') }));
    } else {
      const list = h('div', { class: 'dlg-list' });
      for (const entry of entries) {
        list.append(
          h(
            'button',
            {
              type: 'button',
              class: 'card dlg-tile',
              'data-dialogue': entry.id,
              onclick: () => ctx.navigate(`learn/dialogues/${entry.id}`),
            },
            h('span', { class: 'dlg-tile-title', text: entry.title }),
            h('span', { class: 'dlg-tile-en', text: entry.titleEn }),
            h('span', { class: 'dlg-tile-topic', text: entry.topic }),
          ),
        );
      }
      wrap.append(list);
    }
  } catch (err) {
    console.error('dialogues list', err);
    wrap.append(h('p', { class: 'error', text: t('dialogues.loadError') }));
  }
  container.focus?.({ preventScroll: true });
}

async function renderDialogue(container, ctx, id) {
  let dialogue = null;
  let offline = false;
  try {
    dialogue = await loadDialogue(id);
  } catch (err) {
    offline = err instanceof TypeError;
  }
  if (!dialogue) {
    reset(container).append(
      h('p', { class: 'muted', text: t(offline ? 'common.offline' : 'dialogues.soon') }),
      h('button', { type: 'button', class: 'btn', text: t('dialogues.back'), onclick: () => ctx.navigate('learn/dialogues') }),
    );
    return;
  }

  const lines = dialogue.lines;
  const bothSpeakers = new Set(lines.map((line) => line.speaker)).size > 1;
  const rateFor = (line) => (bothSpeakers && line.speaker === 'B' ? 0.9 : 1);

  reset(container);
  const body = h('div', { class: 'dlg-wrap' });
  const thread = h('div', { class: 'dlg-thread' });
  const modes = h('div', { class: 'dlg-modes', role: 'group', 'aria-label': t('dialogues.modesLabel') });
  const status = h('p', { class: 'hint', 'data-role': 'status' });
  let mode = 'read';
  let showTranslation = true;
  let playing = false;
  let timer = null;

  const stopPlay = () => {
    playing = false;
    if (timer) clearTimeout(timer);
    timer = null;
    playButton.textContent = t('dialogues.playAll');
    playButton.setAttribute('aria-pressed', 'false');
  };

  const wait = (ms) =>
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    });

  const playAll = async () => {
    if (playing) {
      stopPlay();
      return;
    }
    playing = true;
    playButton.textContent = t('dialogues.stop');
    playButton.setAttribute('aria-pressed', 'true');
    for (const line of lines) {
      if (!playing) break;
      await speak(line.zh, { rate: rateFor(line), voice: line.speaker === 'B' ? 'b' : 'a' });
      if (!playing) break;
      await wait(400 + line.zh.length * 180);
    }
    if (playing) stopPlay();
  };

  const playButton = h('button', {
    type: 'button',
    class: 'btn ghost sm',
    'data-action': 'play-all',
    'aria-pressed': 'false',
    text: t('dialogues.playAll'),
    onclick: () => playAll(),
  });

  const translationButton = h('button', {
    type: 'button',
    class: 'chip',
    'data-action': 'toggle-translation',
    'aria-pressed': 'true',
    text: t('dialogues.hideTranslation'),
    onclick: () => {
      showTranslation = !showTranslation;
      translationButton.setAttribute('aria-pressed', String(showTranslation));
      translationButton.textContent = t(showTranslation ? 'dialogues.hideTranslation' : 'dialogues.showTranslation');
      renderBody();
    },
  });

  const mkBubble = (line) =>
    h(
      'div',
      { class: 'dlg-bubble', 'data-speaker': line.speaker },
      h('span', { class: 'dlg-speaker', text: t('dialogues.speaker', { name: line.speaker }) }),
      h('button', {
        type: 'button',
        class: 'dlg-zh',
        lang: 'zh-CN',
        'data-action': 'play-line',
        'aria-label': t('dialogues.playLine'),
        text: line.zh,
        onclick: () => speak(line.zh, { voice: line.speaker === 'B' ? 'b' : 'a' }),
      }),
      h('p', { class: 'pinyin', html: pinyinHtml(line.pinyin) }),
      showTranslation ? h('p', { class: 'dlg-en', text: line.en }) : null,
    );

  const renderRead = () => {
    thread.replaceChildren(...lines.map(mkBubble));
  };

  const renderYouAreB = () => {
    const rounds = choiceRounds(lines);
    if (!rounds.length) {
      thread.replaceChildren(h('p', { class: 'muted', text: t('dialogues.noB') }));
      return;
    }
    let correct = 0;
    const score = h('p', { class: 'hint', 'data-role': 'score' });
    const cards = rounds.map((round) => {
      const result = h('p', { class: 'dlg-result' });
      const buttons = round.options.map((option) =>
        h('button', {
          type: 'button',
          class: 'btn option',
          'data-choice': option.zh,
          text: option.zh,
          onclick: (event) => {
            const ok = isCorrectChoice(option);
            if (ok) correct += 1;
            buttons.forEach((btn) => {
              btn.disabled = true;
            });
            event.currentTarget.setAttribute('aria-pressed', 'true');
            result.dataset.ok = String(ok);
            result.textContent = t(ok ? 'dialogues.correct' : 'dialogues.wrong', { answer: round.answer });
            score.textContent = t('dialogues.score', { correct, total: rounds.length });
          },
        }),
      );
      return h(
        'section',
        { class: 'card dlg-round' },
        round.prompt ? h('p', { class: 'dlg-context', text: `${round.prompt.speaker}: ${round.prompt.zh}` }) : null,
        h('p', { class: 'dlg-context', text: t('dialogues.yourTurn') }),
        h('div', { class: 'dlg-actions dlg-modes' }, ...buttons),
        result,
      );
    });
    score.textContent = t('dialogues.score', { correct: 0, total: rounds.length });
    thread.replaceChildren(h('p', { class: 'hint', text: t('dialogues.youAreBIntro') }), score, ...cards);
  };

  const renderOrder = () => {
    const { items, solution } = orderRound(lines);
    const pool = h('div', { class: 'dlg-order-pool' });
    const slots = h('div', { class: 'dlg-order-slots' });
    const result = h('p', { class: 'dlg-result' });
    const placed = [];
    const refresh = () => {
      if (!placed.length) {
        slots.replaceChildren(h('p', { class: 'muted', text: t('dialogues.orderEmpty') }));
      } else {
        slots.replaceChildren(
          ...placed.map((line, i) =>
            h('button', {
              type: 'button',
              class: 'btn option',
              'data-slot': String(i),
              text: `${i + 1}. ${line.zh}`,
              onclick: () => {
                placed.splice(i, 1);
                pool.append(line._btn);
                result.textContent = '';
                result.dataset.ok = '';
                refresh();
              },
            }),
          ),
        );
      }
    };
    for (const line of items) {
      const btn = h('button', {
        type: 'button',
        class: 'btn option',
        'data-order': line.zh,
        text: line.zh,
        onclick: () => {
          btn.remove();
          placed.push(line);
          line._btn = btn;
          refresh();
        },
      });
      line._btn = btn;
      pool.append(btn);
    }
    refresh();
    const check = h('button', {
      type: 'button',
      class: 'btn primary',
      'data-action': 'check-order',
      text: t('dialogues.check'),
      onclick: () => {
        if (placed.length !== solution.length) {
          result.dataset.ok = 'false';
          result.textContent = t('dialogues.orderIncomplete');
          return;
        }
        const ok = isOrdered(placed, solution);
        result.dataset.ok = String(ok);
        result.textContent = t(ok ? 'dialogues.orderCorrect' : 'dialogues.orderWrong');
      },
    });
    thread.replaceChildren(
      h('p', { class: 'hint', text: t('dialogues.orderIntro') }),
      pool,
      h('h3', { class: 'menu-group-title', text: t('dialogues.yourOrder') }),
      slots,
      check,
      result,
    );
  };

  const renderBody = () => {
    stopPlay();
    if (mode === 'b') renderYouAreB();
    else if (mode === 'order') renderOrder();
    else renderRead();
  };

  const modeButtons = ['read', 'b', 'order'].map((name) =>
    h('button', {
      type: 'button',
      class: 'chip',
      'data-mode': name,
      'aria-pressed': String(name === mode),
      text: t(`dialogues.mode.${name}`),
      onclick: () => {
        mode = name;
        modeButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode)));
        status.textContent = '';
        renderBody();
      },
    }),
  );
  modes.append(...modeButtons);

  const addWords = h('button', {
    type: 'button',
    class: 'btn primary',
    'data-action': 'add-words',
    text: t('dialogues.addWords'),
    onclick: async () => {
      addWords.disabled = true;
      const { added, total } = await addDialogueToReview(dialogue);
      status.textContent = t('dialogues.addedWords', { added, total });
      addWords.disabled = false;
    },
  });

  const done = await getDone(dialogue.id);
  const doneButton = h('button', {
    type: 'button',
    class: 'btn',
    'data-action': 'done',
    text: done ? t('dialogues.done') : t('dialogues.markDone'),
    disabled: Boolean(done),
    onclick: async () => {
      await markDone(dialogue);
      doneButton.textContent = t('dialogues.done');
      doneButton.disabled = true;
    },
  });

  body.append(
    backButton(ctx),
    h(
      'section',
      { class: 'dlg-head' },
      h('h2', { lang: 'zh-CN', text: dialogue.title }),
      dialogue.titleEn || dialogue.topic ? h('p', { class: 'dlg-sub', text: dialogue.titleEn || dialogue.topic }) : null,
      h('div', { class: 'dlg-actions' }, pinyinToggle(), playButton),
      translationButton,
      modes,
      status,
    ),
    thread,
    h('div', { class: 'dlg-actions' }, addWords, doneButton),
  );
  container.append(body);
  renderBody();
  container.focus?.({ preventScroll: true });
  return () => stopPlay();
}
