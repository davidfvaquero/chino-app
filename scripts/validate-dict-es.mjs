// validate-dict-es.mjs — validate every translated Spanish dictionary shard.
//
//   node scripts/validate-dict-es.mjs                       # public/data/es/dict
//   node scripts/validate-dict-es.mjs --out data-work/dict-es/pilot
//
// Checks (per entry, against the English original): same id, no empty defs, no
// stray tags, hanzi + [bracketed pinyin] preserved, glossary markers translated,
// def length within 0.4x-3x of the English, no control chars, no def left
// identical to the English (English leak), no duplicated def inside one entry
// (ERROR, §3.1), no parenthetical usage note left in English (WARNING, §3.4).
// Fewer defs than the English is allowed (a documented merge, rules 6/10).
// Exit code != 0 when there is any error, so it can gate a commit / CI step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEntry, parentheticalLeaks } from './lib/dict-es.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'data', 'dict', 'shards');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadOriginals() {
  const byId = new Map();
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.json'))) {
    for (const e of readJson(path.join(SRC, f))) byId.set(e.id, e);
  }
  return byId;
}

function parseArgs(argv) {
  const o = { out: path.join(ROOT, 'public', 'data', 'es', 'dict'), examples: 15 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else if (argv[i] === '--examples') o.examples = Number(argv[++i]) || 15;
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  return o;
}

async function main(argv) {
  const opt = parseArgs(argv);
  const dir = path.join(opt.out, 'shards');
  if (!fs.existsSync(dir)) {
    console.log(`validate-dict-es: nada que validar en ${path.relative(ROOT, dir)}`);
    return 0;
  }
  const originals = loadOriginals();
  let checked = 0, shardCount = 0, merged = 0;
  const errors = [];
  const warnings = [];
  const add = (id, file, msgs) => { for (const m of msgs) errors.push({ id, file, msg: m }); };
  const warn = (id, file, msgs) => { for (const m of msgs) warnings.push({ id, file, msg: m }); };

  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let list;
    try { list = readJson(path.join(dir, f)); }
    catch (err) { errors.push({ id: '-', file: f, msg: `JSON inválido: ${err.message}` }); continue; }
    if (!Array.isArray(list)) { errors.push({ id: '-', file: f, msg: 'el shard no es una lista' }); continue; }
    shardCount++;
    for (const es of list) {
      const en = originals.get(es.id);
      if (!en) { add(es.id, f, ['id no existe en el diccionario original']); continue; }
      checked++;
      add(es.id, f, validateEntry(en, es));
      warn(es.id, f, parentheticalLeaks(en, es));
      if (es.defs.length < en.defs.length) merged++;
    }
  }

  console.log(`validate-dict-es: ${shardCount} shards, ${checked} entradas, ${errors.length} errores, ${warnings.length} avisos`);
  if (merged) console.log(`  (${merged} entradas con menos defs que el inglés: sentidos fusionados)`);
  if (errors.length) {
    const byMsg = new Map();
    for (const e of errors) byMsg.set(e.msg, (byMsg.get(e.msg) || 0) + 1);
    console.log('  tipos de error:');
    for (const [msg, n] of [...byMsg].sort((a, b) => b[1] - a[1])) console.log(`   ${n.toString().padStart(6)}  ${msg}`);
    console.log(`  ejemplos (${Math.min(opt.examples, errors.length)}):`);
    for (const e of errors.slice(0, opt.examples)) console.log(`   id ${e.id} :: ${e.file} :: ${e.msg}`);
  }
  if (warnings.length) {
    const byMsg = new Map();
    for (const w of warnings) byMsg.set(w.msg, (byMsg.get(w.msg) || 0) + 1);
    console.log('  avisos:');
    for (const [msg, n] of [...byMsg].sort((a, b) => b[1] - a[1])) console.log(`   ${n.toString().padStart(6)}  ${msg}`);
    console.log(`  ejemplos de aviso (${Math.min(opt.examples, warnings.length)}):`);
    for (const w of warnings.slice(0, opt.examples)) console.log(`   id ${w.id} :: ${w.file} :: ${w.msg}`);
  }
  return errors.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = await main(process.argv.slice(2)).catch((err) => { console.error('validate-dict-es failed:', err.message || err); return 1; });
}
