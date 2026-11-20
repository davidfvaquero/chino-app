#!/usr/bin/env node
// fix-dict-es.mjs — deterministic repair of the translated Spanish shards.
//
//   node scripts/fix-dict-es.mjs [dir]      # default public/data/es/dict
//
// Two repairs, no LLM, idempotent:
//   1. translate any English marker/usage note that leaked into a Spanish def
//      (used in -> se usa en, CL: -> clasificador:, (Tw) -> (Taiwán), …);
//   2. drop a definition identical to an earlier one in the same entry (the
//      documented "merge the senses" fix, §3.1 of docs/DICT-ES-PILOT.md).
// Run it before scripts/validate-dict-es.mjs. Writes a shard only when changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixLeakedMarkers, templateDefToEs } from './lib/dict-es.mjs';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\u00e0-\u00ff]+/g, ' ').trim();

// A usage note the translator silently dropped: restore it in front of the def.
// [English marker in the original def, Spanish note it must produce]
const NOTE_RESTORE = [['(Tw)', '(Taiwán)'], ['(dialect)', '(dialecto)'], ['(slang)', '(coloquial)']];

/** One-off restoration of a def the translator mangled: a "see X" marker turned
 *  into "variante de", or a dropped (Tw)/(dialect)/(slang) usage note. */
function restoreDef(enDef, esDef) {
  let out = esDef;
  if (/^see\s+\S*[\[[\u3400-\u9fff]/u.test(enDef) && !/véase/.test(out)) {
    out = out.replace(/^\s*variante de\s+/, 'véase ');
  }
  for (const [en, esNote] of NOTE_RESTORE) {
    if (enDef.includes(en) && !out.includes(esNote.slice(1, -1))) out = `${esNote} ${out}`;
  }
  return out;
}

/** @returns {{defs: string[], fixed: number, deduped: number}} */
export function repairEntry(en, entry) {
  const src = entry.defs || [];
  const fixedDefs = src.map((d, i) => fixLeakedMarkers(en && en.defs ? restoreDef(en.defs[i] || '', d) : d));
  const fixed = fixedDefs.filter((d, i) => d !== src[i]).length;
  const seen = new Set();
  const defs = [];
  let deduped = 0;
  for (const d of fixedDefs) {
    const k = norm(d);
    if (k && seen.has(k)) { deduped++; continue; }
    seen.add(k);
    defs.push(d);
  }
  // A classifier definition dropped in a merge: restore it from the original.
  let added = 0;
  if (en && Array.isArray(en.defs) && !defs.some((d) => d.includes('clasificador'))) {
    for (const d of en.defs) if (/^CL:/.test(d)) { defs.push(templateDefToEs(d)); added = 1; break; }
  }
  return { defs, fixed: fixed + added, deduped };
}

function loadOriginals(srcDir) {
  const byId = new Map();
  for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.json'))) {
    for (const e of JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'))) byId.set(e.id, e);
  }
  return byId;
}

function main(argv) {
  const dir = path.resolve(argv[0] || fileURLToPath(new URL('../public/data/es/dict/', import.meta.url)));
  const shardsDir = path.join(dir, 'shards');
  if (!fs.existsSync(shardsDir)) { console.log(`fix-dict-es: no shards in ${dir}`); return 0; }
  const originals = loadOriginals(fileURLToPath(new URL('../public/data/dict/shards/', import.meta.url)));
  let fixed = 0, deduped = 0, changed = 0;
  for (const f of fs.readdirSync(shardsDir).filter((x) => x.endsWith('.json')).sort()) {
    const p = path.join(shardsDir, f);
    const list = JSON.parse(fs.readFileSync(p, 'utf8'));
    let dirty = false;
    for (const e of list) {
      const r = repairEntry(originals.get(e.id), e);
      if (r.fixed || r.deduped) { e.defs = r.defs; fixed += r.fixed; deduped += r.deduped; dirty = true; }
    }
    if (dirty) { const tmp = `${p}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(list)}\n`); fs.renameSync(tmp, p); changed++; }
  }
  console.log(`fix-dict-es: ${fixed} defs reparadas, ${deduped} defs duplicadas quitadas (${changed} shards escritos)`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
