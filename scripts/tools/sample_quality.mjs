import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIORITY = path.join(ROOT, 'data-work', 'dict-es', 'priority.json');
const OUT = path.join(ROOT, 'data-work', 'dict-es', 'quality_sample.json');

const priority = JSON.parse(fs.readFileSync(PRIORITY, 'utf8'));

const t1_ids = priority.tiers[1];
const t2_ids = priority.tiers[2];
const template_ids = priority.tiers.template;

console.log(`T1 (nivel 1): ${t1_ids.length} entries`);
console.log(`T2 (nivel 2): ${t2_ids.length} entries`);
console.log(`Template: ${template_ids.length} entries`);

const t2_mid = Math.floor(t2_ids.length / 2);
const t2_comun = t2_ids.slice(0, t2_mid);
const t2_rara = t2_ids.slice(t2_mid);

console.log(`T2 común (first half): ${t2_comun.length} entries`);
console.log(`T2 rara (second half): ${t2_rara.length} entries`);

// Fisher-Yates shuffle for reproducible sampling
function shuffle(array, seed = 42) {
  const arr = [...array];
  let state = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const sample_t1 = shuffle(t1_ids).slice(0, 100);
const sample_t2_comun = shuffle(t2_comun).slice(0, 100);
const sample_t2_rara = shuffle(t2_rara).slice(0, 100);
const sample_template = shuffle(template_ids).slice(0, 20);

const samples = {
  t1: sample_t1,
  t2_comun: sample_t2_comun,
  t2_rara: sample_t2_rara,
  template: sample_template
};

fs.writeFileSync(OUT, JSON.stringify(samples, null, 2));
console.log('Samples saved to', OUT);
console.log('T1 sample:', sample_t1.slice(0, 5));
console.log('T2 común sample:', sample_t2_comun.slice(0, 5));
console.log('T2 rara sample:', sample_t2_rara.slice(0, 5));
console.log('Template sample:', sample_template.slice(0, 5));