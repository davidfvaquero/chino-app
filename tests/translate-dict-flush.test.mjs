/**
 * translate-dict-flush.test.mjs — offline test of the disk dumps of
 * scripts/translate-dict.mjs: a run of 60 one-entry batches with a fake model
 * is killed with SIGTERM mid-way; what was dumped must survive, and the next
 * start must continue without translating again what is already on disk.
 * No network; only temp dirs (never public/data or data-work).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flushPending, loadDoneIds } from '../scripts/translate-dict.mjs';

const SCRIPT_URL = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'translate-dict.mjs')).href;
const N = 60;

// Child process: runs translateRun with a fake model (50 ms per batch, logs the ids it was asked for).
const HARNESS = `
import fs from 'node:fs';
import { translateRun, parseArgs, loadDoneIds } from ${JSON.stringify(SCRIPT_URL)};
const { OUT, LOG, DELAY } = process.env;
const ids = Array.from({ length: ${N} }, (_, i) => i + 1);
const entries = new Map(ids.map((id) => [id, { id, simp: 'x', pinyin: 'y', defs: ['to go'], shard: id % 3 }]));
const done = loadDoneIds(OUT);
const llmIds = ids.filter((id) => !done.has(id));
const call = async (opt, batch) => {
  await new Promise((r) => setTimeout(r, Number(DELAY)));
  fs.appendFileSync(LOG, batch.map((e) => e.id).join(',') + '\\n');
  return { entries: batch.map((e) => ({ id: e.id, defs: ['fake ' + e.id] })), inTok: 0, outTok: 0, usd: 0 };
};
const opt = parseArgs(['--provider', 'openrouter', '--out', OUT, '--batch', '1', '--concurrency', '1', '--pause', '0']);
const tiers = { '1': new Set(ids), '2': new Set(), template: new Set() };
const r = await translateRun(opt, { entries, templateIds: [], llmIds, done, tiers, call });
console.log('FIN ' + r.flushed);
`;

const childEnv = (out, log, delay) => ({ ...process.env, OUT: out, LOG: log, DELAY: String(delay) });
const readIds = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).flatMap((l) => l.split(',').map(Number)) : []);

/** id -> defs of everything on disk; throws on a duplicated id (same id in two shard files). */
function onDisk(out) {
  const dir = path.join(out, 'shards');
  const byId = new Map();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue;
    for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      assert.ok(!byId.has(e.id), `id ${e.id} duplicado en disco`);
      byId.set(e.id, e.defs);
    }
  }
  return byId;
}

test('flushPending es idempotente y solo toca los shards con datos', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tdflush-'));
  try {
    const entries = new Map([[1, { id: 1, shard: 0 }], [2, { id: 2, shard: 5 }]]);
    flushPending(out, entries, [{ id: 1, defs: ['a'] }]);
    flushPending(out, entries, [{ id: 1, defs: ['a'] }, { id: 1, defs: ['a2'] }]); // repetido: gana el último
    assert.deepEqual(onDisk(out), new Map([[1, ['a2']]]));
    assert.deepEqual(fs.readdirSync(path.join(out, 'shards')), ['000.json']);
    assert.deepEqual(loadDoneIds(out), new Set([1]));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('SIGTERM a mitad de 60 lotes: lo volcado se conserva y el siguiente arranque no repite', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tdkill-'));
  const out = path.join(base, 'out');
  const log1 = path.join(base, 'calls1.log');
  const log2 = path.join(base, 'calls2.log');
  try {
    // Run 1: SIGTERM right after the second dump (batch 50 of 60).
    const { code, lines } = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', HARNESS],
        { env: childEnv(out, log1, 50), stdio: ['ignore', 'pipe', 'inherit'] });
      let text = '';
      let sent = false;
      child.stdout.on('data', (buf) => {
        text += buf;
        if (!sent && text.split('\n').filter((l) => l.includes('volcado:')).length === 2) {
          sent = true;
          child.kill('SIGTERM');
        }
      });
      child.on('exit', (c) => resolve({ code: c, lines: text.split('\n') }));
    });
    assert.equal(code, 0, 'SIGTERM debe salir con código 0');
    const progress = lines.filter((l) => l.includes('volcado:'));
    assert.ok(progress.length >= 2);
    assert.match(progress[0], /^\[\d\d:\d\d:\d\d\] volcado: 25 entradas hechas \(T1 25, T2 0\), lotes ok\/invalidos 25\/0, coste ~\$0\.0000$/);
    assert.match(progress[1], /volcado: 50 entradas hechas/);

    const afterKill = onDisk(out);
    assert.ok(afterKill.size >= 50 && afterKill.size < N, `tras matar: ${afterKill.size} en disco`);
    for (const [id, defs] of afterKill) assert.deepEqual(defs, [`fake ${id}`]);

    // Run 2: no kill; must only ask for the ids that were not on disk.
    const run2 = spawnSync(process.execPath, ['--input-type=module', '-e', HARNESS],
      { env: childEnv(out, log2, 0), encoding: 'utf8' });
    assert.equal(run2.status, 0, run2.stderr);
    assert.match(run2.stdout, /FIN \d+/);

    const asked2 = readIds(log2);
    assert.equal(asked2.length, N - afterKill.size, 'run 2 pide solo lo que falta');
    for (const id of asked2) assert.ok(!afterKill.has(id), `id ${id} repetido tras reanudar`);

    const final = onDisk(out);
    assert.equal(final.size, N);
    for (let id = 1; id <= N; id++) assert.deepEqual(final.get(id), [`fake ${id}`]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
