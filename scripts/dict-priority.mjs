// dict-priority.mjs — compute the translation order for the Spanish dictionary.
//
// Reads every CC-CEDICT shard plus the learner corpora (HSK lists, lessons,
// readings, Tatoeba sentences, themes), segments the corpus with the same
// greedy longest-match idea as src/dictionary.js (substring match against the
// full word set), and writes data-work/dict-es/priority.json:
//
//   { generatedAt, counts, estimatedCostUsd, tiers:{1,2,template}, order:[ids] }
//
//   T1  words that appear in any learner content (HSK, lessons, readings,
//       sentences, themes), ordered by sentence-corpus frequency (desc). In a
//       global audience the highest-frequency ones are the useful ones.
//   T2  everything else, short words first (1-2 hanzi), then most definitions.
//   template  entries whose EVERY definition is a bare marker ("surname X",
//       "variant of Y", "old variant of Y", "CL:...") — resolved without the
//       LLM (see lib/dict-es.mjs) and left last.
//
// Usage: node scripts/dict-priority.mjs   (no network, no API key needed)
// ponytail: frequency by substring/segmentation is an approximation; a proper
// corpus tokeniser would only reorder the ties.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyEntry, estimateTokens, costUsd, PRICE } from './lib/dict-es.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const WORK = path.join(ROOT, 'data-work', 'dict-es', 'priority.json');

const HANZI_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const MAX_WORD = 8;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listJson = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...listJson(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
};

/** All CC-CEDICT entries, each tagged with its shard index. */
function loadEntries() {
  const dir = path.join(DATA, 'dict', 'shards');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const entries = [];
  files.forEach((file, shard) => {
    for (const e of readJson(path.join(dir, file))) entries.push({ ...e, shard });
  });
  return entries;
}

/** Every hanzi-bearing string anywhere inside a parsed JSON value. */
function collectHanzi(value, out) {
  if (typeof value === 'string') {
    if (HANZI_RE.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectHanzi(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectHanzi(v, out);
  }
  return out;
}

/**
 * Corpus: { sentences:[zh strings], content:[hanzi strings], explicit:Set(words) }
 * `sentences` drives the frequency; `content` + `explicit` decide T1 membership.
 */
function buildCorpus() {
  const sentences = [];
  for (const p of listJson(path.join(DATA, 'sentences', 'shards'))) {
    for (const s of readJson(p)) if (s && s.zh) sentences.push(s.zh);
  }
  const content = [];
  for (const p of listJson(path.join(DATA, 'readings'))) collectHanzi(readJson(p), content);
  for (const p of listJson(path.join(DATA, 'lessons'))) collectHanzi(readJson(p), content);
  const explicit = new Set();
  for (const p of listJson(path.join(DATA, 'themes'))) {
    const t = readJson(p);
    for (const w of t.words || []) if (w && w.hanzi) explicit.add(w.hanzi);
    collectHanzi(t, content);
  }
  for (let lvl = 1; lvl <= 6; lvl++) {
    const p = path.join(DATA, 'hsk', `${lvl}.json`);
    if (!fs.existsSync(p)) continue;
    for (const it of readJson(p).items || []) if (it && it.hanzi) explicit.add(it.hanzi);
  }
  return { sentences, content, explicit };
}

/** Greedy longest-match segmentation; returns the matched words (hanzi only). */
function segment(text, wordSet) {
  const s = String(text ?? '');
  const out = [];
  for (let i = 0; i < s.length; ) {
    if (!HANZI_RE.test(s[i])) { i += 1; continue; }
    let matched = null;
    for (let len = Math.min(MAX_WORD, s.length - i); len >= 1; len--) {
      const cand = s.slice(i, i + len);
      if (wordSet.has(cand)) { matched = cand; break; }
    }
    if (matched) { out.push(matched); i += matched.length; } else i += 1;
  }
  return out;
}

async function main() {
  const entries = loadEntries();
  const wordSet = new Set();
  for (const e of entries) { wordSet.add(e.simp); if (e.trad) wordSet.add(e.trad); }

  const { sentences, content, explicit } = buildCorpus();
  const freq = new Map();
  for (const zh of sentences) {
    for (const w of segment(zh, wordSet)) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const t1Words = new Set(explicit);
  for (const txt of content) for (const w of segment(txt, wordSet)) t1Words.add(w);
  for (const w of freq.keys()) t1Words.add(w);

  const t1 = [], t2 = [], template = [];
  for (const e of entries) {
    if (classifyEntry(e) === 'template') { template.push(e); continue; }
    const f = (freq.get(e.simp) || 0) + (e.trad ? freq.get(e.trad) || 0 : 0);
    if (t1Words.has(e.simp) || (e.trad && t1Words.has(e.trad))) t1.push({ e, f });
    else t2.push(e);
  }
  t1.sort((a, b) => b.f - a.f || a.e.id - b.e.id);
  t2.sort((a, b) => a.simp.length - b.simp.length || (b.defs.length - a.defs.length) || a.id - b.id);

  const ids1 = t1.map((x) => x.e.id);
  const ids2 = t2.map((e) => e.id);
  const idsT = template.map((e) => e.id);

  // per-tier cost from English definition chars (input) and ~1.15x (output)
  const byId = new Map(entries.map((e) => [e.id, e]));
  const tierCost = (ids) => {
    const chars = ids.reduce((s, id) => s + (byId.get(id)?.defs.join(' ').length || 0), 0);
    const inTok = estimateTokens(chars, ids.length);
    const outTok = estimateTokens(Math.round(chars * 1.15), ids.length);
    return { entries: ids.length, inTok, outTok, usd: costUsd(inTok, outTok) };
  };
  const summary = {
    generatedAt: new Date().toISOString(),
    counts: { total: entries.length, t1: ids1.length, t2: ids2.length, template: idsT.length },
    pricePerMTok: { in: PRICE.in, out: PRICE.out },
    estimatedCostUsd: { t1: tierCost(ids1), t2: tierCost(ids2), template: { entries: idsT.length, usd: 0 } },
    tiers: { 1: ids1, 2: ids2, template: idsT },
    order: [...ids1, ...ids2, ...idsT],
  };
  fs.mkdirSync(path.dirname(WORK), { recursive: true });
  fs.writeFileSync(WORK, JSON.stringify(summary));

  const t1c = tierCost(ids1), t2c = tierCost(ids2);
  console.log(`dict-priority: ${entries.length} entradas`);
  console.log(`  T1   ${ids1.length} entradas  ~$${t1c.usd.toFixed(3)}  (${t1c.inTok}+${t1c.outTok} tok)`);
  console.log(`  T2   ${ids2.length} entradas  ~$${t2c.usd.toFixed(3)}  (${t2c.inTok}+${t2c.outTok} tok)`);
  console.log(`  tmpl ${idsT.length} entradas  $0 (plantilla, sin LLM)`);
  console.log(`  TOTAL ~$${(t1c.usd + t2c.usd).toFixed(3)} @ $${PRICE.in}/$${PRICE.out} por M tok`);
  console.log(`  -> ${path.relative(ROOT, WORK)}`);
}

main().catch((err) => { console.error('dict-priority failed:', err); process.exit(1); });
