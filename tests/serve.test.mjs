// Checks the static server's contract: MIME types and Cache-Control.
// Spawns scripts/serve.mjs on a free port (no browser needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serveScript = fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url));

function startServer(dir, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serveScript, dir, '--port', '0', '--host', '127.0.0.1', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', reject);
  });
}

let dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chino-serve-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><h1>hi</h1>');
  await writeFile(join(dir, 'sw.js'), "const VERSION = 'dev';");
  await writeFile(join(dir, 'manifest.webmanifest'), '{"name":"Chino"}');
  await writeFile(join(dir, 'data.json'), '{"a":1}');
  await writeFile(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});
after(() => rm(dir, { recursive: true, force: true }));

test('MIME types and Cache-Control', async (t) => {
  const { child, port } = await startServer(dir);
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  const head = async (path) => {
    const res = await fetch(base + path);
    await res.arrayBuffer();
    return res;
  };

  const index = await head('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  assert.equal(index.headers.get('cache-control'), 'no-cache'); // shell: revalidate

  const sw = await head('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /^text\/javascript/);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');

  const manifest = await head('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /^application\/manifest\+json/);

  const data = await head('/data.json');
  assert.equal(data.status, 200);
  assert.match(data.headers.get('content-type'), /^application\/json/);
  assert.equal(data.headers.get('cache-control'), 'public, max-age=86400'); // static data caches

  const svg = await head('/icon.svg');
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /^image\/svg\+xml/);

  assert.equal((await head('/nope')).status, 404);
});

test('--no-cache-shell serves the shell no-store', async (t) => {
  const { child, port } = await startServer(dir, ['--no-cache-shell']);
  t.after(() => child.kill());
  const res = await fetch(`http://127.0.0.1:${port}/sw.js`);
  await res.arrayBuffer();
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
