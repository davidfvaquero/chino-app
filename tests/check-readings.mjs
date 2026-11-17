import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { segment, configure, lookup } from '../src/dictionary.js';
import { loadReading } from '../src/reading/data.js';
import { normalizeReading } from '../src/reading/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

async function fileFetch(url) {
  const rel = url.replace(/^\/data\//, '');
  const text = await fs.promises.readFile(path.join(DATA, rel), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

configure({ fetch: fileFetch });

async function checkReading(id) {
  const raw = await loadReading(id, { fetch: fileFetch });
  const reading = normalizeReading(raw);
  console.log('\n=== ' + reading.title + ' (' + id + ') ===');
  let allOk = true;
  for (const line of reading.lines) {
    console.log('  Line:', line.hanzi);
    const parts = await segment(line.hanzi);
    console.log('  Segments:', parts);
    for (const part of parts) {
      if (/[\u3400-\u9fff]/.test(part)) {
        const entry = await lookup(part);
        if (!entry) {
          console.log('    WARNING: Not in dictionary:', part);
          allOk = false;
        } else {
          console.log('    OK:', part, '->', entry.simp, entry.pinyin);
        }
      }
    }
  }
  return allOk;
}

async function main() {
  const r1 = await checkReading('reading-01');
  const r2 = await checkReading('reading-02');
  const r3 = await checkReading('reading-03');
  if (r1 && r2 && r3) {
    console.log('\n✅ All readings segment fully with dictionary entries');
    process.exit(0);
  } else {
    console.log('\n❌ Some words not found in dictionary');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });