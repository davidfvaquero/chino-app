// Guards HSK1 readings 28-34: schema, index agreement, and every hanzi token
// segmentable by the dictionary. Pure Node, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segment, configure, lookup } from '../src/dictionary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const IDS = [28, 29, 30, 31, 32, 33, 34].map((n) => `reading-${String(n).padStart(2, '0')}`);
const HANZI = /[\u3400-\u9fff]/;

configure({
  fetch: async (url) => {
    const text = await fs.promises.readFile(path.join(DATA, url.replace(/^\/data\//, '')), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  },
});

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'readings/hsk1/index.json'), 'utf8'));

for (const id of IDS) {
  test(`${id}: schema, index agreement, segmentable`, async () => {
    const r = JSON.parse(fs.readFileSync(path.join(DATA, 'readings/hsk1', `${id}.json`), 'utf8'));
    assert.equal(r.id, id);
    assert.ok(r.title && r.topic);
    assert.ok(['text', 'dialogue'].includes(r.type));
    assert.ok(Array.isArray(r.lines) && r.lines.length > 0);
    const entry = index.find((x) => x.id === id);
    assert.equal(entry.title, r.title);
    assert.equal(entry.topic, r.topic);
    for (const line of r.lines) {
      for (const k of ['hanzi', 'pinyin', 'english']) assert.ok(line[k], `${id} empty ${k}`);
      if (r.type === 'dialogue') assert.ok(line.speaker, `${id} no speaker`);
      for (const token of await segment(line.hanzi)) {
        if (!HANZI.test(token)) continue;
        assert.ok(await lookup(token), `${id}: "${token}" not in dictionary (${line.hanzi})`);
      }
    }
  });
}
