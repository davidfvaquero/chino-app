import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_FILE = path.join(ROOT, 'data-work', 'dict-es', 'quality_sample.json');
const EN_SHARDS = path.join(ROOT, 'public', 'data', 'dict', 'shards');
const ES_SHARDS = path.join(ROOT, 'public', 'data', 'es', 'dict', 'shards');
const OUT_FILE = path.join(ROOT, 'data-work', 'dict-es', 'quality_sample_full.json');

const samples = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));

// Collect all unique IDs
const allIds = new Set();
for (const [stratum, ids] of Object.entries(samples)) {
  for (const id of ids) allIds.add(id);
}
console.log(`Total unique IDs to fetch: ${allIds.size}`);

// Load English entries
const enById = new Map();
for (const file of fs.readdirSync(EN_SHARDS).filter(f => f.endsWith('.json')).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(EN_SHARDS, file), 'utf8'));
  for (const e of data) {
    if (allIds.has(e.id)) {
      enById.set(e.id, e);
    }
  }
}

// Load Spanish entries
const esById = new Map();
for (const file of fs.readdirSync(ES_SHARDS).filter(f => f.endsWith('.json')).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(ES_SHARDS, file), 'utf8'));
  for (const e of data) {
    if (allIds.has(e.id)) {
      esById.set(e.id, e);
    }
  }
}

console.log(`Found ${enById.size} English entries, ${esById.size} Spanish entries`);

// Build output
const output = {};
for (const [stratum, ids] of Object.entries(samples)) {
  output[stratum] = [];
  for (const id of ids) {
    const en = enById.get(id);
    const es = esById.get(id);
    if (!en || !es) {
      console.warn(`Missing entry for id ${id}: en=${!!en}, es=${!!es}`);
      continue;
    }
    output[stratum].push({
      id,
      hanzi: en.simp + (en.trad && en.trad !== en.simp ? '/' + en.trad : ''),
      pinyin: en.pinyin,
      pinyinNumeric: en.pinyinNumeric,
      en_defs: en.defs,
      es_defs: es.defs
    });
  }
  console.log(`Stratum ${stratum}: ${output[stratum].length} entries`);
}

fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
console.log('Full sample data saved to', OUT_FILE);