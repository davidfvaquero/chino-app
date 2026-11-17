/**
 * Dev server: serves the project root as-is (it is the same layout as dist/),
 * generating manifest.webmanifest on the fly so the app copy stays in en.json.
 * Zero dependencies.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { manifestFromLocale } from './manifest.mjs';

const root = new URL('../', import.meta.url);
const rootPath = root.pathname;
const port = Number(process.env.PORT ?? process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 5173);

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

async function serveFile(res, path, type) {
  const body = await readFile(path);
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    if (urlPath === '/manifest.webmanifest') {
      const locale = JSON.parse(await readFile(new URL('src/locales/en.json', root), 'utf8'));
      res.writeHead(200, { 'content-type': TYPES['.webmanifest'], 'cache-control': 'no-store' });
      res.end(JSON.stringify(manifestFromLocale(locale, 'en'), null, 2));
      return;
    }
    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
    let target = join(rootPath, rel);
    let info = await stat(target).catch(() => null);
    if (!info) {
      // public/* is copied to the dist root by the build, so mirror that here.
      target = join(rootPath, 'public', rel);
      info = await stat(target).catch(() => null);
    }
    if (!info || info.isDirectory()) target = join(target, 'index.html');
    await serveFile(res, target, TYPES[extname(target)] ?? 'application/octet-stream');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(port, () => {
  console.log(`dev: http://localhost:${port}/ (root ${rootPath})`);
});
