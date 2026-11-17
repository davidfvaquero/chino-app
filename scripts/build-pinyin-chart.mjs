#!/usr/bin/env node
/**
 * build-pinyin-chart.mjs — generates public/data/pinyin-chart.json.
 *
 * Why: the browser TTS engine reads a bare pinyin syllable ("ma") badly, so for
 * every syllable+tone the chart points at a real, common hanzi with that exact
 * reading, and the screen speaks the hanzi instead.
 *
 * Inputs (already generated, see public/data/dict/manifest.json and hsk/index.json):
 *   public/data/dict/shards/*.json  CC-CEDICT entries [{id,simp,trad,pinyin,pinyinNumeric,defs}]
 *   public/data/hsk/<1..6>.json     HSK words [{level,hanzi,pinyin,pinyinNumeric,english}]
 *
 * Frequency proxy (no external word-frequency list needed):
 *   score(char) = HSK bonus  +  CC-CEDICT usage
 *     HSK bonus   = (7 - level) * 1e6   when an HSK word pairs this char with
 *                                       this exact reading (word pinyin split
 *                                       per syllable; level 1 = most common)
 *     usage       = number of CC-CEDICT entries whose simplified form contains it
 *   The best-scoring char per (syllable, tone) wins. Tones with no common char
 *   are emitted with `hanzi: null` (the screen marks them "no audio").
 *   Aligning the reading matters: 吗 is an HSK-1 word *with tone 5*, so it must
 *   not win the ma2 slot over 麻 just for being common.
 *
 * Output shape (public/data/pinyin-chart.json):
 *   {
 *     generatedAt, sources,
 *     initials: ['', 'b', 'p', ... , 'w'],           // '' = zero-initial (a, an, er…)
 *     finals:   ['a', 'o', 'e', ...],                 // only finals attested in the data
 *     syllables: { ma: { initial, final, tones: [ {tone,pinyin,hanzi,english} x4 ] }, ... },
 *     grid:      { m: ['a','ai',...], ... }           // valid finals per initial
 *   }
 *
 * Run: node scripts/build-pinyin-chart.mjs   (or npm run data:pinyin-chart)
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pinyinToMarks } from '../src/pinyin.js';

const ROOT = new URL('../', import.meta.url);
const HSK_DIR = new URL('public/data/hsk/', ROOT);
const SHARD_DIR = new URL('public/data/dict/shards/', ROOT);
const OUT = new URL('public/data/pinyin-chart.json', ROOT);

/** Display order of the initials (the task's list; '' = zero-initial syllables). */
export const INITIALS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w'];
/** Display order of the finals (union of what the data attests). */
export const FINALS = ['a', 'o', 'e', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er', 'i', 'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong', 'u', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ue', 'ü', 'üe'];

const TWO_CHAR_INITIALS = ['zh', 'ch', 'sh'];
const ONE_CHAR_INITIALS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
const BASIC_HANZI = /^[\u4e00-\u9fff]$/;

/**
 * Syllable key from a numbered pinyin string, preserving ü:
 *   'nu:3' -> 'nü'   'lv4' -> 'lü'   'ma1' -> 'ma'
 * (src/pinyin.js#tonelessKey folds ü to u; the chart must keep them apart.)
 */
export function syllableKey(pinyinNumeric) {
  return String(pinyinNumeric ?? '')
    .trim()
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/v/g, 'ü')
    .replace(/[1-5]/g, '')
    .replace(/[^a-zü]/g, '');
}

/** Trailing tone number of a numbered pinyin string, or null. */
export function toneOf(pinyinNumeric) {
  const match = String(pinyinNumeric ?? '').match(/([1-5])\s*$/);
  return match ? Number(match[1]) : null;
}

/**
 * Split numbered pinyin into syllables: every tone digit closes one syllable, so
 * 'ma1ma5' -> ['ma1','ma5'] and 'bu2 ke4qi5' -> ['bu2','ke4','qi5'].
 */
export function splitSyllables(pinyinNumeric) {
  const out = [];
  let buffer = '';
  for (const ch of String(pinyinNumeric ?? '')) {
    if (/\s/.test(ch)) continue;
    buffer += ch;
    if (/[1-5]/.test(ch)) {
      out.push(buffer);
      buffer = '';
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

/** Split a syllable into { initial, final }, or null when it is not a real syllable. */
export function decompose(syllable) {
  const s = String(syllable ?? '');
  if (!s) return null;
  let initial = '';
  for (const ini of TWO_CHAR_INITIALS) if (s.startsWith(ini)) { initial = ini; break; }
  if (!initial) for (const ini of ONE_CHAR_INITIALS) if (s.startsWith(ini)) { initial = ini; break; }
  const final = s.slice(initial.length);
  if (!final || !FINALS.includes(final)) return null;
  return { initial, final };
}

/** Short English gloss for a chart entry (first useful definition, trimmed). */
function firstGloss(defs) {
  const list = (Array.isArray(defs) ? defs : []).filter((d) => typeof d === 'string' && d.trim());
  const skip = /^(variant of|old variant of|see |surname |used in )/i;
  const def = list.find((d) => !skip.test(d.trim())) ?? list[0];
  if (!def) return null;
  const text = def.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || null;
}

/**
 * Build the chart object from raw HSK items and CC-CEDICT entries.
 * Pure (no file I/O) so tests can drive it with a small fixture.
 */
export function buildChart({ hskItems = [], cedictEntries = [], generatedAt = new Date().toISOString() } = {}) {
  // --- char statistics -----------------------------------------------------
  const hskReading = new Map(); // 'char|key|tone' -> lowest HSK level with that reading
  const hskWords = new Map(); // char -> number of HSK words containing it (light tiebreak)
  const candidates = []; // { char, key, tone, defs }

  for (const item of hskItems) {
    const hanzi = String(item.hanzi ?? '');
    const level = Number(item.level) || 0;
    const chars = [...hanzi];
    for (const ch of new Set(chars)) hskWords.set(ch, (hskWords.get(ch) ?? 0) + 1);

    // Align the word's pinyin with its characters, then record each reading.
    const syllables = splitSyllables(item.pinyinNumeric);
    if (syllables.length === chars.length) {
      chars.forEach((ch, i) => {
        const key = syllableKey(syllables[i]);
        const tone = toneOf(syllables[i]);
        if (!key || tone < 1 || tone > 4) return;
        const id = `${ch}|${key}|${tone}`;
        const prev = hskReading.get(id);
        if (prev === undefined || level < prev) hskReading.set(id, level);
      });
    }
    if (chars.length === 1 && BASIC_HANZI.test(hanzi)) {
      const key = syllableKey(item.pinyinNumeric);
      const tone = toneOf(item.pinyinNumeric);
      if (key && tone >= 1 && tone <= 4) {
        candidates.push({ char: hanzi, key, tone, defs: item.english ? [String(item.english)] : [] });
      }
    }
  }

  const usage = new Map(); // char -> number of CC-CEDICT entries containing it
  for (const entry of cedictEntries) {
    const simp = String(entry.simp ?? '');
    for (const ch of new Set([...simp])) usage.set(ch, (usage.get(ch) ?? 0) + 1);
    if ([...simp].length === 1 && BASIC_HANZI.test(simp)) {
      const key = syllableKey(entry.pinyinNumeric);
      const tone = toneOf(entry.pinyinNumeric);
      if (key && tone >= 1 && tone <= 4) {
        candidates.push({ char: simp, key, tone, defs: entry.defs });
      }
    }
  }

  const scoreOf = (char, key, tone) => {
    const level = hskReading.get(`${char}|${key}|${tone}`);
    const bonus = level !== undefined ? (7 - level) * 1_000_000 : 0;
    return bonus + (usage.get(char) ?? 0) + (hskWords.get(char) ?? 0);
  };

  // --- best char per (syllable, tone) --------------------------------------
  const best = new Map(); // 'key|tone' -> { char, defs, score }
  for (const cand of candidates) {
    const id = `${cand.key}|${cand.tone}`;
    const score = scoreOf(cand.char, cand.key, cand.tone);
    const prev = best.get(id);
    if (!prev || score > prev.score || (score === prev.score && cand.char < prev.char)) {
      best.set(id, { char: cand.char, defs: cand.defs, score });
    }
  }

  // --- assemble syllables ---------------------------------------------------
  const syllables = {};
  for (const [id, cand] of best) {
    const [key, toneText] = id.split('|');
    const tone = Number(toneText);
    const parts = decompose(key);
    if (!parts) continue; // not a real syllable (interjections like 'hm', 'ng')
    const record = (syllables[key] ??= { initial: parts.initial, final: parts.final, tones: [] });
    record.tones[tone - 1] = { tone, pinyin: pinyinToMarks(`${key}${tone}`), hanzi: cand.char, english: firstGloss(cand.defs) };
  }

  for (const record of Object.values(syllables)) {
    for (let tone = 1; tone <= 4; tone += 1) {
      if (!record.tones[tone - 1]) {
        record.tones[tone - 1] = { tone, pinyin: pinyinToMarks(`${record.initial}${record.final}${tone}`), hanzi: null, english: null };
      }
    }
  }

  // --- grid + finals --------------------------------------------------------
  const gridSets = new Map();
  const finalsSeen = new Set();
  for (const record of Object.values(syllables)) {
    if (!gridSets.has(record.initial)) gridSets.set(record.initial, new Set());
    gridSets.get(record.initial).add(record.final);
    finalsSeen.add(record.final);
  }

  const finals = FINALS.filter((f) => finalsSeen.has(f));
  const initials = ['', ...INITIALS].filter((ini) => gridSets.has(ini));
  const grid = {};
  for (const ini of initials) grid[ini] = finals.filter((f) => gridSets.get(ini).has(f));

  return {
    generatedAt,
    sources: {
      cedict: 'CC-CEDICT (CC BY-SA 4.0)',
      hsk: 'HSK 2.0 official vocabulary via hskhsk.com (MIT)',
    },
    initials,
    finals,
    syllables: Object.fromEntries(Object.entries(syllables).sort(([a], [b]) => (a < b ? -1 : 1))),
    grid,
  };
}

/** Read the raw HSK + CC-CEDICT inputs from public/data/. */
export async function loadSources() {
  const hskFiles = (await readdir(HSK_DIR)).filter((name) => /^\d+\.json$/.test(name));
  const hskItems = [];
  for (const file of hskFiles) {
    const data = JSON.parse(await readFile(new URL(file, HSK_DIR), 'utf8'));
    hskItems.push(...(data.items ?? []));
  }

  const shardFiles = (await readdir(SHARD_DIR)).filter((name) => name.endsWith('.json'));
  const cedictEntries = [];
  for (const file of shardFiles) {
    const shard = JSON.parse(await readFile(new URL(file, SHARD_DIR), 'utf8'));
    cedictEntries.push(...shard);
  }
  return { hskItems, cedictEntries };
}

async function main() {
  const { hskItems, cedictEntries } = await loadSources();
  const chart = buildChart({ hskItems, cedictEntries });
  await writeFile(OUT, `${JSON.stringify(chart)}\n`);
  const withAudio = Object.values(chart.syllables).filter((s) => s.tones.some((t) => t.hanzi)).length;
  console.log(
    `pinyin-chart: ${Object.keys(chart.syllables).length} syllables (${withAudio} with audio), ` +
      `${chart.initials.length} initials x ${chart.finals.length} finals -> ${OUT.pathname}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
