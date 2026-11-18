/**
 * Static server for headless checks and local dev. Zero dependencies.
 *
 *   node scripts/serve.mjs [dir]           # default: dist/
 *   node scripts/serve.mjs [dir] --port 8095 --host 127.0.0.1
 *   PORT=8080 node scripts/serve.mjs       # env fallback, default: a free port
 *
 * Flags: --port <n> (or --port=n / PORT env), --host <addr> (default: all
 * interfaces), --no-cache-shell (serve the shell with no-store; see below).
 *
 * It serves `dir` as-is, following symlinks (so a release symlink like
 * .../current always resolves to the release it points at), and on top of
 * plain files it does the two things that normally only exist after a build,
 * so the *source* tree can be served the same way (that is how `npm run dev`
 * uses it):
 *   - <...>/locales/<code>.json is returned with the <code>.d/*.json shards
 *     merged in (a key defined twice is a hard error, like in the build);
 *   - /manifest.webmanifest is generated from the merged en locale when the
 *     file is not on disk.
 *
 * Cache-Control: the shell (index.html, sw.js, manifest.webmanifest) is never
 * reused blind -> `Cache-Control: no-cache` (revalidate, so a new deploy is
 * picked up). Everything else is static -> `public, max-age=86400`. With
 * `--no-cache-shell` the shell is served `no-store` instead (dev: keep no copy
 * at all). Errors are always `no-store`.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestFromLocale } from './manifest.mjs';
import { hasShards, loadMergedLocale } from './build-locales.mjs';

// --- args: the first non-flag is the dir; --port/--host/--no-cache-shell win.
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const eq = args[i].indexOf('=');
  return eq >= 0 ? args[i].slice(eq + 1) : args[i + 1];
};
const dirArg = args.find((a) => !a.startsWith('--'));
const noCacheShell = args.includes('--no-cache-shell');

const rootPath = resolve(dirArg ?? process.env.SERVE_DIR ?? 'dist');
const root = pathToFileURL(`${rootPath}/`);
const port = Number(flag('port') ?? process.env.PORT ?? 0); // 0 = let the OS pick a free port
const host = flag('host'); // undefined = every interface

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

// Shell = files a deploy must never serve stale; everything else caches hard.
const cacheControlFor = (file) => {
  const name = basename(file);
  if (name === 'index.html' || name === 'sw.js' || name === 'manifest.webmanifest') {
    return noCacheShell ? 'no-store' : 'no-cache';
  }
  return 'public, max-age=86400';
};

const send = (res, status, type, body, cacheControl = 'no-store') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': cacheControl });
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
    let info = await stat(target).catch(() => null); // stat follows symlinks
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
    send(res, 200, TYPES[extname(target)] ?? 'application/octet-stream', await readFile(target), cacheControlFor(target));
  } catch (err) {
    send(res, 500, TYPES['.txt'], `serve error: ${err.message}`);
  }
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(`serve: http://localhost:${address.port}/ (root ${rootPath})`);
});
