/**
 * Static server for headless checks and local dev. Zero dependencies.
 *
 *   node scripts/serve.mjs [dir]     # default: dist/
 *   PORT=8080 node scripts/serve.mjs # default: a free port, printed on start
 *
 * It serves `dir` as-is, and on top of plain files it does the two things that
 * normally only exist after a build, so the *source* tree can be served the
 * same way (that is how `npm run dev` uses it):
 *   - <...>/locales/<code>.json is returned with the <code>.d/*.json shards
 *     merged in (a key defined twice is a hard error, like in the build);
 *   - /manifest.webmanifest is generated from the merged en locale when the
 *     file is not on disk.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestFromLocale } from './manifest.mjs';
import { hasShards, loadMergedLocale } from './build-locales.mjs';

const rootPath = resolve(process.argv[2] ?? process.env.SERVE_DIR ?? 'dist');
const root = pathToFileURL(`${rootPath}/`);
const port = Number(process.env.PORT ?? 0); // 0 = let the OS pick a free port

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const send = (res, status, type, body) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');

    // 1. locale files: merge the sibling <code>.d/ shards when they exist
    const locale = /^(.*\/)?locales\/([^/]+)\.json$/.exec(rel);
    if (locale) {
      const dir = new URL(`${locale[1] ?? ''}locales/`, root);
      if (await hasShards(dir, locale[2])) {
        return send(res, 200, TYPES['.json'], JSON.stringify(await loadMergedLocale(dir, locale[2]), null, 2));
      }
    }

    // 2. static file (public/ is mirrored at the root, like the build does)
    let target = join(rootPath, rel);
    let info = await stat(target).catch(() => null);
    if (!info) {
      target = join(rootPath, 'public', rel);
      info = await stat(target).catch(() => null);
    }
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info) {
      if (rel === 'manifest.webmanifest') {
        const dict = await loadMergedLocale(new URL('src/locales/', root), 'en');
        return send(res, 200, TYPES['.webmanifest'], JSON.stringify(manifestFromLocale(dict, 'en'), null, 2));
      }
      return send(res, 404, TYPES['.txt'], 'not found');
    }
    if (!target.startsWith(rootPath + sep) && target !== rootPath) {
      return send(res, 403, TYPES['.txt'], 'forbidden');
    }
    send(res, 200, TYPES[extname(target)] ?? 'application/octet-stream', await readFile(target));
  } catch (err) {
    send(res, 500, TYPES['.txt'], `serve error: ${err.message}`);
  }
});

server.listen(port, () => {
  const address = server.address();
  console.log(`serve: http://localhost:${address.port}/ (root ${rootPath})`);
});
