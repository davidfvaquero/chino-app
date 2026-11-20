// translate-dict.mjs — translate CC-CEDICT definitions to neutral Spanish with
// an LLM, in priority order, resumably.
//
//   node scripts/translate-dict.mjs --tier 1 --limit 300 --dry-run
//   node scripts/translate-dict.mjs --strata pilot --out data-work/dict-es/pilot
//   node scripts/translate-dict.mjs --provider openrouter --model deepseek/deepseek-v4-flash
//
// Providers:
//   anthropic  (DEFAULT) the user's Claude Code OAuth subscription. No
//              OpenRouter balance is spent. Token is read from
//              ~/.claude/.credentials.json on EVERY call (never printed/stored).
//              The Claude session/weekly quota is polled with
//              ~/.hermes/scripts/claude_usage.py and the run stops cleanly at
//              session >= 96% or weekly >= 50%.
//   openrouter the cheap API: key from env OPENROUTER_API_KEY, stop knobs
//              --max-usd and --min-balance (default 1.0 USD remaining).
//
// Output (atomic tmp+rename, merged with what is already there):
//   <out>/shards/NNN.json  ->  [{id, defs:[...]}]   only the translated entries.
// State stays under data-work/dict-es/ (gitignored): --out defaults to
// public/data/es/dict for the real run, data-work/.../pilot for the pilot.
// ponytail: concurrency <= 3 (<=2 with Claude) + a short pause between batches
// so the homelab CPU (shared with Minecraft) is not starved; run under `nice`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GLOSSARY, buildBatches, computeToDo, parseTranslation, resolveTemplateDefs,
  mergeShardEntries, classifyEntry, estimateTokens, costUsd, PRICE,
} from './lib/dict-es.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const WORK = path.join(ROOT, 'data-work', 'dict-es');
const PRIORITY = path.join(WORK, 'priority.json');
const FAILED = path.join(WORK, 'failed.json');
const OR_API = 'https://openrouter.ai/api/v1';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const CRED_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_SCRIPT = path.join(os.homedir(), '.hermes', 'scripts', 'claude_usage.py');
const CC_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

const DEFAULTS = { anthropic: 'claude-haiku-5-5', openrouter: 'deepseek/deepseek-v4.1-flash' };

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const o = { provider: 'anthropic', tier: '1', limit: 0, maxUsd: 0, minBalance: 1.0,
    concurrency: 0, batch: 40, model: '', dryRun: false, strata: '', out: '', pause: 150 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--provider') o.provider = String(val());
    else if (a === '--tier') o.tier = String(val());
    else if (a === '--limit') o.limit = Number(val()) || 0;
    else if (a === '--max-usd') o.maxUsd = Number(val()) || 0;
    else if (a === '--min-balance') o.minBalance = Number(val());
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(val()) || 0);
    else if (a === '--batch') o.batch = Math.max(1, Number(val()) || 40);
    else if (a === '--model') o.model = String(val());
    else if (a === '--out') o.out = String(val());
    else if (a === '--strata') o.strata = String(val());
    else if (a === '--pause') o.pause = Number(val()) || 0;
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  if (!['anthropic', 'openrouter'].includes(o.provider)) throw new Error(`--provider inválido: ${o.provider}`);
  if (!o.model) o.model = DEFAULTS[o.provider];
  const cap = o.provider === 'anthropic' ? 2 : 3;
  if (!o.concurrency) o.concurrency = cap;
  if (o.concurrency > cap) { console.warn(`  aviso: concurrencia limitada a ${cap} con ${o.provider}`); o.concurrency = cap; }
  if (!o.out) o.out = o.strata === 'pilot' ? path.join(WORK, 'pilot') : path.join(DATA, 'es', 'dict');
  return o;
}

// ---------------------------------------------------------------- data
function loadEntries() {
  const dir = path.join(DATA, 'dict', 'shards');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const byId = new Map();
  files.forEach((file, shard) => {
    for (const e of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) byId.set(e.id, { ...e, shard });
  });
  return byId;
}

function readExistingShard(outDir, shard) {
  const p = path.join(outDir, 'shards', `${String(shard).padStart(3, '0')}.json`);
  if (!fs.existsSync(p)) return { path: p, entries: [] };
  try { return { path: p, entries: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch { return { path: p, entries: [] }; }
}

/** Every id already translated in the output dir (resumption / idempotency). */
function loadDoneIds(outDir) {
  const dir = path.join(outDir, 'shards');
  const done = new Set();
  if (!fs.existsSync(dir)) return done;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) done.add(e.id); }
    catch { /* ignore a half-written file */ }
  }
  return done;
}

function writeShardAtomic(outDir, shard, fresh) {
  const { path: file, entries: existing } = readExistingShard(outDir, shard);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const merged = mergeShardEntries(existing, fresh);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(merged));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- stratification
/** 300-id pilot sample: 100 common T1, 100 rare T1, 80 varied T2, 20 template. */
export function selectStrata(priority) {
  const t1 = priority.tiers['1'] || [];
  const t2 = priority.tiers['2'] || [];
  const tp = priority.tiers.template || [];
  const common = t1.slice(0, 100);
  const rare = t1.slice(-100);
  const varied = [];
  const step = Math.max(1, Math.floor(t2.length / 80));
  for (let i = 0; i < t2.length && varied.length < 80; i += step) varied.push(t2[i]);
  const template = tp.slice(0, 20);
  return [...new Set([...common, ...rare, ...varied, ...template])];
}

// ---------------------------------------------------------------- prompts
const SYSTEM = `You translate Chinese dictionary (CC-CEDICT) definitions from English into neutral Spanish. You are a dictionary, not a tutor.

RULES
1. Output ONLY a JSON array, no prose, no code fence: [{"id":<same id>,"defs":["..."]}]. Same ids, same number of definitions, same order. Never merge, drop, add or reorder senses.
2. Neutral Spanish, no regionalisms, no "tú/usted"; definitions are noun/adjective phrases and infinitives ("ir", "comer", "ser feliz"), never full sentences.
3. Keep untouched: Chinese characters (hanzi) and their bracketed pinyin, e.g. 好[hao3]; proper names; numbers; units; abbreviations.
4. Use this FIXED glossary for CC-CEDICT markers (translate the marker, keep what follows):
${GLOSSARY.map(([e, s]) => `   ${e} -> ${s}`).join('\n')}
5. Do not explain, do not add notes, do not transliterate. Length stays close to the English.
Example: "surname Wang" -> "apellido Wang"; "variant of 好[hao3]" -> "variante de 好[hao3]"; "to go" -> "ir"; "CL:個|个[ge4]" -> "clasificador:個|个[ge4]".`;

function userPrompt(entries) {
  const payload = entries.map((e) => ({ id: e.id, hanzi: e.simp, pinyin: e.pinyin, defs: e.defs }));
  return `Translate the defs of every entry into neutral Spanish. Return the JSON array only.\n${JSON.stringify(payload)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- OpenRouter
async function creditsRemaining(key) {
  try {
    const r = await fetch(`${OR_API}/credits`, { headers: { Authorization: `Bearer ${key}` } });
    const d = (await r.json()).data || {};
    if (typeof d.total_credits === 'number') return d.total_credits - (d.total_usage || 0);
  } catch { /* fall through */ }
  try {
    const r = await fetch(`${OR_API}/key`, { headers: { Authorization: `Bearer ${key}` } });
    const d = (await r.json()).data || {};
    if (typeof d.limit_remaining === 'number') return d.limit_remaining;
    if (typeof d.limit === 'number') return d.limit - (d.usage || 0);
  } catch { /* give up */ }
  return null;
}

async function callOpenRouter(opt, entries) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('falta OPENROUTER_API_KEY en el entorno');
  const r = await fetch(`${OR_API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opt.model, temperature: 0,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(entries) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${j.error?.message || 'sin detalle'}`); e.status = r.status; throw e; }
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error('respuesta sin contenido');
  const parsed = parseTranslation(text, entries);
  if (!parsed.ok) throw new Error(parsed.error);
  const u = j.usage || {};
  const inTok = u.prompt_tokens || estimateTokens(entries.reduce((s, e) => s + e.defs.join(' ').length, 0), entries.length);
  const outTok = u.completion_tokens || inTok;
  return { entries: parsed.entries, inTok, outTok, usd: typeof u.cost === 'number' ? u.cost : costUsd(inTok, outTok) };
}

// ---------------------------------------------------------------- Anthropic (Claude Code OAuth)
/** Read the OAuth token fresh from disk on every call; refresh via hermes if it
 *  is about to expire. The token is NEVER logged or written anywhere. */
function claudeToken() {
  const read = () => {
    const j = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    const o = j.claudeAiOauth || j;
    return { token: o.accessToken, expiresAt: o.expiresAt };
  };
  let { token, expiresAt } = read();
  if (!token) { const e = new Error('sin accessToken en ~/.claude/.credentials.json'); e.code = 3; throw e; }
  if (expiresAt && expiresAt - Date.now() < 10 * 60 * 1000) {
    spawnSync('hermes', ['-p', 'haiku', 'chat', '-q', 'ok'], { stdio: 'ignore' });
    ({ token, expiresAt } = read());
    if (!expiresAt || expiresAt - Date.now() < 10 * 60 * 1000) {
      const e = new Error('token de Claude caducado; refresca el login o reintenta más tarde'); e.code = 3; throw e;
    }
  }
  return token;
}

let usageCache = { at: 0, val: null };
/** Claude session/weekly utilisation (%), polled at most once per minute. */
function claudeUsage(force = false) {
  if (!force && Date.now() - usageCache.at < 60 * 1000) return usageCache.val;
  const r = spawnSync('python3', [USAGE_SCRIPT], { encoding: 'utf8' });
  usageCache = { at: Date.now(), val: r.status === 0 ? JSON.parse(r.stdout) : null };
  return usageCache.val;
}
export const usageExhausted = (u) => !!u && (u.session >= 96 || u.weekly >= 50);

async function callAnthropic(opt, entries) {
  const token = claudeToken();
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'content-type': 'application/json',
      'User-Agent': 'claude-cli/2.0.0 (external, cli)',
      'x-app': 'cli',
    },
    body: JSON.stringify({ model: opt.model, max_tokens: 4096,
      system: [{ type: 'text', text: CC_PREFIX }, { type: 'text', text: SYSTEM }],
      messages: [{ role: 'user', content: userPrompt(entries) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${j.error?.message || 'sin detalle'}`); e.status = r.status; throw e; }
  const text = j.content?.[0]?.text;
  if (!text) throw new Error('respuesta sin contenido');
  const parsed = parseTranslation(text, entries);
  if (!parsed.ok) throw new Error(parsed.error);
  const u = j.usage || {};
  return { entries: parsed.entries, inTok: u.input_tokens || 0, outTok: u.output_tokens || 0, usd: 0 };
}

const callModel = (opt, entries) => (opt.provider === 'anthropic' ? callAnthropic(opt, entries) : callOpenRouter(opt, entries));

/** Retry 429/529 with exponential backoff; give up (code 4) after 3 tries. */
async function callWithBackoff(opt, entries) {
  const delays = [30000, 60000, 120000];
  for (let i = 0; ; i++) {
    try { return await callModel(opt, entries); }
    catch (err) {
      if ((err.status === 429 || err.status === 529) && i < delays.length) { await sleep(delays[i]); continue; }
      if (err.status === 429 || err.status === 529) { const e = new Error('3 fallos seguidos (429/529)'); e.code = 4; throw e; }
      throw err;
    }
  }
}

/** One batch with a single retry that splits it in half. */
async function runBatch(opt, entries, depth, stats) {
  try {
    const r = await callWithBackoff(opt, entries);
    stats.inTok += r.inTok; stats.outTok += r.outTok; stats.usd += r.usd;
    return r.entries;
  } catch (err) {
    if (err.code === 4 || err.code === 3) throw err;
    stats.invalid += 1;
    if (depth >= 1 || entries.length === 1) {
      stats.errors.push({ ids: entries.map((e) => e.id), error: String(err.message || err) });
      return [];
    }
    const mid = Math.ceil(entries.length / 2);
    const a = await runBatch(opt, entries.slice(0, mid), depth + 1, stats);
    const b = await runBatch(opt, entries.slice(mid), depth + 1, stats);
    return [...a, ...b];
  }
}

// ---------------------------------------------------------------- run
function writeSummary(opt, summary) {
  if (opt.strata === 'pilot') {
    fs.mkdirSync(opt.out, { recursive: true });
    fs.writeFileSync(path.join(opt.out, 'pilot.json'), JSON.stringify(summary));
  }
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(path.join(WORK, 'last-run.json'), JSON.stringify(summary));
}

async function main(argv) {
  const opt = parseArgs(argv);
  const entries = loadEntries();
  if (!fs.existsSync(PRIORITY)) throw new Error('falta data-work/dict-es/priority.json — ejecuta scripts/dict-priority.mjs');
  const priority = JSON.parse(fs.readFileSync(PRIORITY, 'utf8'));

  let scope;
  if (opt.strata === 'pilot') scope = selectStrata(priority);
  else if (['1', '2', 'template'].includes(opt.tier)) scope = priority.tiers[opt.tier] || [];
  else throw new Error(`--tier inválido: ${opt.tier}`);
  if (opt.limit > 0) scope = scope.slice(0, opt.limit);

  const done = loadDoneIds(opt.out);
  const todo = computeToDo(scope, done);
  const templateIds = todo.filter((id) => classifyEntry(entries.get(id)) === 'template');
  const llmIds = todo.filter((id) => classifyEntry(entries.get(id)) !== 'template');
  const llmChars = llmIds.reduce((s, id) => s + (entries.get(id)?.defs.join(' ').length || 0), 0);
  const estIn = estimateTokens(llmChars, llmIds.length);
  const estOut = estimateTokens(Math.round(llmChars * 1.15), llmIds.length);

  console.log(`translate-dict [${opt.provider} / ${opt.model}]: scope ${scope.length}, ya hechos ${scope.length - todo.length}, a traducir ${todo.length}`);
  console.log(`  plantilla (sin LLM): ${templateIds.length} | LLM: ${llmIds.length} en ${Math.ceil(llmIds.length / opt.batch)} lotes, concurrencia ${opt.concurrency}`);
  console.log(`  tokens estimados: ${estIn}+${estOut}${opt.provider === 'openrouter' ? `  ~$${costUsd(estIn, estOut).toFixed(4)}` : ''}`);
  console.log(`  out: ${path.relative(ROOT, opt.out)}`);
  if (opt.dryRun) return 0;

  const stats = { inTok: 0, outTok: 0, usd: 0, invalid: 0, errors: [] };
  const usageStart = opt.provider === 'anthropic' ? claudeUsage(true) : null;
  let balance = null;
  if (opt.provider === 'openrouter') {
    balance = await creditsRemaining(process.env.OPENROUTER_API_KEY || '');
    console.log(`  saldo restante: ${balance === null ? 'desconocido' : `$${balance.toFixed(3)}`} (mínimo $${opt.minBalance}, máx $${opt.maxUsd || '∞'})`);
    if (balance !== null && balance < opt.minBalance) { console.log('  PARADO: saldo por debajo del mínimo.'); return 2; }
  } else {
    console.log(`  Claude: sesión ${usageStart?.session ?? '?'}% (reset ${usageStart?.session_resets || '?'}), semana ${usageStart?.weekly ?? '?'}%`);
    if (usageExhausted(usageStart)) {
      console.log('  PARADO: cuota de Claude agotada (sesión >= 96% o semana >= 50%).');
      writeSummary(opt, { when: new Date().toISOString(), provider: opt.provider, model: opt.model,
        stoppedEarly: 'usage-at-start', usageStart, translated: 0 });
      return 0;
    }
  }

  const results = [];
  let stopped = false, stopReason = '';
  for (const id of templateIds) results.push({ id, defs: resolveTemplateDefs(entries.get(id).defs) });

  const batches = buildBatches(llmIds.map((id) => entries.get(id)), opt.batch);
  let next = 0;
  const workers = Array.from({ length: opt.concurrency }, async () => {
    while (!stopped) {
      const i = next++;
      if (i >= batches.length) return;
      const out = await runBatch(opt, batches[i], 0, stats);
      results.push(...out.map((e) => ({ id: e.id, defs: e.defs })));
      if (opt.pause) await sleep(opt.pause);
      if (opt.provider === 'anthropic') {
        if (usageExhausted(claudeUsage())) { stopped = true; stopReason = 'usage'; return; }
      } else if ((opt.maxUsd > 0 && stats.usd >= opt.maxUsd) || (balance !== null && balance - stats.usd < opt.minBalance)) {
        stopped = true; stopReason = opt.maxUsd > 0 && stats.usd >= opt.maxUsd ? 'max-usd' : 'min-balance'; return;
      }
    }
  });
  await Promise.all(workers);

  const byShard = new Map();
  for (const item of results) {
    const shard = entries.get(item.id).shard;
    if (!byShard.has(shard)) byShard.set(shard, []);
    byShard.get(shard).push(item);
  }
  for (const [shard, fresh] of byShard) writeShardAtomic(opt.out, shard, fresh);

  // totals per tier from what is now on disk
  const nowDone = loadDoneIds(opt.out);
  const tierSets = { '1': new Set(priority.tiers['1'] || []), '2': new Set(priority.tiers['2'] || []), template: new Set(priority.tiers.template || []) };
  const perTier = { 1: 0, 2: 0, template: 0 };
  const scopeSet = new Set(priority.order || []);
  for (const id of scopeSet) {
    if (!nowDone.has(id)) continue;
    for (const [k, s] of Object.entries(tierSets)) if (s.has(id)) perTier[k === 'template' ? 'template' : k]++;
  }
  const usageEnd = opt.provider === 'anthropic' ? claudeUsage(true) : null;
  const delta = usageStart && usageEnd ? { session: usageEnd.session - usageStart.session, weekly: usageEnd.weekly - usageStart.weekly } : null;

  const summary = {
    when: new Date().toISOString(), provider: opt.provider, model: opt.model, out: path.relative(ROOT, opt.out),
    scope: scope.length, translated: results.length, template: templateIds.length,
    llmRequests: batches.length, invalidBatches: stats.invalid,
    promptTokens: stats.inTok, completionTokens: stats.outTok, costUsd: Number(stats.usd.toFixed(6)),
    failed: stats.errors.map((e) => e.id), doneTotal: nowDone.size, donePerTier: perTier,
    usageStart: usageStart ? { session: usageStart.session, weekly: usageStart.weekly } : null,
    usageEnd: usageEnd ? { session: usageEnd.session, weekly: usageEnd.weekly } : null,
    usageDelta: delta, stoppedEarly: stopped ? stopReason : null,
  };
  writeSummary(opt, summary);
  if (stats.errors.length) {
    const prev = fs.existsSync(FAILED) ? JSON.parse(fs.readFileSync(FAILED, 'utf8')) : [];
    fs.writeFileSync(FAILED, JSON.stringify([...prev, ...stats.errors]));
  }

  console.log(`\nhecho: ${results.length} entradas (${templateIds.length} plantilla)`);
  console.log(`  lotes ${batches.length}, inválidos ${stats.invalid}, fallidos ${stats.errors.length}`);
  console.log(`  tokens ${stats.inTok}+${stats.outTok}${opt.provider === 'openrouter' ? `  coste real ~$${stats.usd.toFixed(5)}` : ''}`);
  if (delta) console.log(`  Claude delta: sesión ${delta.session >= 0 ? '+' : ''}${delta.session}% (${usageEnd.session}%), semana ${delta.weekly >= 0 ? '+' : ''}${delta.weekly}% (${usageEnd.weekly}%)`);
  console.log(`  hechas en total: ${nowDone.size} (T1 ${perTier[1]}, T2 ${perTier[2]}, plantilla ${perTier.template})`);
  if (stopped) console.log(`  (parado por ${stopReason})`);
  return stats.errors.length && !results.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = await main(process.argv.slice(2)).catch((err) => {
    console.error(`translate-dict failed: ${err.message || err}`);
    return err.code === 3 ? 3 : err.code === 4 ? 4 : 1;
  });
}
