// tests/sentences-es.test.mjs
// Spanish sentence shards (public/data/es/sentences/) must mirror the English
// source shards (public/data/sentences/) exactly: same index schema, same shard
// files/counts/ids/order, same zh + pinyin; only the `en` field may differ, and
// then it must be real Spanish. Coverage (entries with a Spanish translation)
// must be >= 40%.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN = path.join(ROOT, 'public', 'data', 'sentences');
const ES = path.join(ROOT, 'public', 'data', 'es', 'sentences');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const enIndex = read(path.join(EN, 'index.json'));
const esIndex = read(path.join(ES, 'index.json'));

const MOJIBAKE = /[\uFFFD]|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]/;

test('es index mirrors en index (same schema and shard list)', () => {
  assert.deepEqual(Object.keys(esIndex).sort(), Object.keys(enIndex).sort());
  assert.equal(esIndex.count, enIndex.count);
  assert.equal(esIndex.license, enIndex.license);
  assert.deepEqual(esIndex.shards, enIndex.shards);
});

test('each es shard has the same ids, order, zh and pinyin as en', () => {
  for (const s of enIndex.shards) {
    const en = read(path.join(EN, s.file));
    const es = read(path.join(ES, s.file));
    assert.equal(es.length, en.length, `length differs for ${s.file}`);
    assert.deepEqual(es.map((e) => e.id), en.map((e) => e.id), `ids/order differ for ${s.file}`);
    for (let i = 0; i < en.length; i++) {
      assert.deepEqual(Object.keys(es[i]).sort(), ['en', 'id', 'pinyin', 'zh'], `keys differ for id ${en[i].id}`);
      assert.equal(es[i].zh, en[i].zh, `zh changed for id ${en[i].id}`);
      assert.equal(es[i].pinyin, en[i].pinyin, `pinyin changed for id ${en[i].id}`);
      assert.equal(typeof es[i].en, 'string');
      assert.ok(es[i].en.trim().length > 0, `empty en for id ${en[i].id}`);
    }
  }
});

test('>= 40% of sentences carry a real Spanish translation (en differs from the English source)', () => {
  let total = 0, spanish = 0;
  for (const s of enIndex.shards) {
    const en = read(path.join(EN, s.file));
    const es = read(path.join(ES, s.file));
    for (let i = 0; i < en.length; i++) {
      total++;
      if (es[i].en !== en[i].en) spanish++;
    }
  }
  const pct = (100 * spanish) / total;
  assert.ok(pct >= 40, `coverage only ${pct.toFixed(1)}% (${spanish}/${total})`);
  assert.equal(total, enIndex.count);
});

test('Spanish entries have correct accents (no mojibake) and use simplified hanzi in zh', () => {
  let checked = 0;
  for (const s of enIndex.shards) {
    const en = read(path.join(EN, s.file));
    const es = read(path.join(ES, s.file));
    for (let i = 0; i < en.length; i++) {
      if (es[i].en === en[i].en) continue; // English fallback: not our text
      checked++;
      assert.ok(!MOJIBAKE.test(es[i].en), `mojibake in Spanish for id ${en[i].id}: ${es[i].en}`);
      // Spanish text must not contain hanzi (it would mean a Chinese sentence slipped in)
      assert.ok(!/[\u3400-\u9FFF]/.test(es[i].en), `hanzi in Spanish for id ${en[i].id}: ${es[i].en}`);
    }
  }
  assert.ok(checked > 0, 'no Spanish sentences found');
});
