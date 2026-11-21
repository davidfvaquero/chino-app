/**
 * prompts.js — system prompt and reply parsing for the conversation partner.
 *
 * The AI is told to answer in SIMPLIFIED Chinese, 1-2 short sentences, at the
 * chosen HSK level, and to return STRICT JSON:
 *   {"zh": "...", "pinyin": "...", "en": "...", "correction": "..."}
 * so the screen can show hanzi + colored pinyin + a tappable translation.
 *
 * `parseReply` is deliberately forgiving: fenced code blocks, stray prose
 * around the JSON, or plain text all collapse to the same shape.
 */

import { trimHistory } from './providers.js';
import { t } from '../i18n.js';

export const HSK_LEVELS = [1, 2, 3];

/** Predefined roleplay situations. `labelKey` is the i18n key for the UI chip. */
export const SCENARIOS = [
  { id: 'introductions', labelKey: 'conversation.scenario.introductions' },
  { id: 'food', labelKey: 'conversation.scenario.food' },
  { id: 'directions', labelKey: 'conversation.scenario.directions' },
  { id: 'shopping', labelKey: 'conversation.scenario.shopping' },
];

/** English topic text handed to the model (not shown to the user). */
const SCENARIO_TOPICS = {
  introductions: 'the learner introduces themselves: name, where they are from, what they do',
  food: 'ordering food at a restaurant: what to eat, drinks, the bill',
  directions: 'asking for and giving simple directions around a city',
  shopping: 'buying things in a shop: prices, sizes, paying',
};

/** A canned opening line per scenario, so a new conversation starts without an API call.
 *  The Chinese and pinyin are fixed; the translation follows the app language. */
const OPENERS = {
  introductions: { zh: '你好！你叫什么名字？', pinyin: 'nǐ hǎo! nǐ jiào shén me míng zi?' },
  food: { zh: '你想吃什么？', pinyin: 'nǐ xiǎng chī shén me?' },
  directions: { zh: '你想去哪儿？', pinyin: 'nǐ xiǎng qù nǎr?' },
  shopping: { zh: '你想买什么？', pinyin: 'nǐ xiǎng mǎi shén me?' },
};

export function openerFor(scenario) {
  const id = OPENERS[scenario] ? scenario : 'introductions';
  // The translation follows the app language: "en" used to be hard-coded.
  return { ...OPENERS[id], en: t(`conversation.opener.${id}`) };
}

export function scenarioTopic(scenario) {
  return SCENARIO_TOPICS[scenario] || SCENARIO_TOPICS.introductions;
}

export function buildSystemPrompt({ level = 1, scenario = 'introductions', uiLang = 'en' } = {}) {
  const hsk = HSK_LEVELS.includes(Number(level)) ? Number(level) : 1;
  // The translation follows the app language: "en" used to be hard-coded.
  const translation = uiLang === 'es' ? 'Spanish' : 'English';
  return [
    'You are a friendly Mandarin Chinese conversation partner for a beginner learner.',
    `The learner is at HSK ${hsk} level: use only very common words and the simplest grammar.`,
    'Always reply in SIMPLIFIED Chinese, in 1 or 2 short sentences.',
    `Roleplay this situation: ${scenarioTopic(scenario)}.`,
    'Gently correct the learner: if their last message has a mistake, put a one-line note in "correction".',
    'Reply with STRICT JSON only, no markdown, with exactly these keys:',
    `{"zh":"<reply in simplified Chinese>","pinyin":"<the same reply in pinyin with tone marks>","tr":"<the same reply translated into ${translation}>","correction":"<short note about the learner mistake, or empty string>"}`,
  ].join(' ');
}

/** System prompt + the (already trimmed) chat history, ready for send(). */
export function buildMessages({ level = 1, scenario = 'introductions', uiLang = 'en', history = [] } = {}) {
  return trimHistory([{ role: 'system', content: buildSystemPrompt({ level, scenario, uiLang }) }, ...history]);
}

function stripFences(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** First balanced {...} block in the text, or null. */
function extractBraces(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const EMPTY = { zh: '', pinyin: '', en: '', correction: '' };

/** Normalize a model reply into `{ zh, pinyin, en, correction }`. */
export function parseReply(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ...EMPTY };
  const cleaned = stripFences(raw);
  const candidates = [cleaned, extractBraces(cleaned)].filter(Boolean);
  for (const candidate of candidates) {
    let obj;
    try {
      obj = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return {
        zh: String(obj.zh ?? obj.chinese ?? ''),
        pinyin: String(obj.pinyin ?? ''),
        en: String(obj.en ?? obj.tr ?? obj.english ?? ''),
        correction: String(obj.correction ?? obj.note ?? ''),
      };
    }
  }
  return { ...EMPTY, zh: raw };
}
