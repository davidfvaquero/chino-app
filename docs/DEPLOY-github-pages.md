# Publicar chino-app en GitHub Pages

Guía para David. Todo lo de la sección 4 son **números medidos** en este repo el
2026-11-18, no estimaciones. Nada de esto publica nada por sí solo: hasta que no
hagas la sección 2, la app sigue siendo local.

---

## 1. ¿Cabe? — tamaños reales frente a los límites

Medido con:

```sh
sh scripts/build-pages.sh                 # genera ./dist-pages
du -sb dist-pages ; find dist-pages -type f | wc -l
find dist-pages -type f -printf '%s %p\n' | sort -rn | head -1
du -sb .git ; du -sh .git
git ls-files -z | xargs -0 du -cb | tail -1
```

| Cosa | Medido | Límite | ¿Cabe? |
| --- | --- | --- | --- |
| Sitio publicado (`dist-pages/`) | **57.640.363 B = 57,6 MB (55,0 MiB)** | GitHub Pages: 1 GB | **Sí** — usa el 5,8 % |
| Nº de archivos del sitio | **558** | Cloudflare Pages: 20.000 | Sí — 2,8 % |
| Archivo más grande del sitio | **`data/hsk/6.json` = 336.792 B (329 KiB)** | GitHub Pages: 100 MB por archivo; Cloudflare: 25 MiB por archivo | Sí — 0,3 % de 100 MB |
| Archivos rastreados por git (sin `.git/`) | **58.098.284 B = 58,1 MB (55,4 MiB)** | GitHub Pages: repo recomendado ≤ 1 GB | Sí — 5,8 % |
| Tamaño de `.git/` | **23.737.462 B = 23,7 MB (22,6 MiB)**; `du -sh .git` → `27M` | — (cuenta en el repo) | Sí |
| Tests antes de desplegar | **471 pass / 0 fail** (`npm test`) | — | Sí |

**Conclusión: cabe de sobra en GitHub Pages y también en Cloudflare Pages
(plan B, ver §6).** Límites *blandos* de GitHub Pages que también conviene
conocer: 10 builds por hora y ~100 GB de tráfico al mes; un push normal está
muy por debajo de ambos.

---

## 2. Publicar — paso a paso

### 2.1 Crear el repositorio en GitHub

1. Entra en <https://github.com/new> con tu cuenta.
2. **Repository name**: `chino-app` (si usas otro nombre, la URL final cambia:
   `https://<usuario>.github.io/<nombre-del-repo>/`).
3. Visibilidad: **Public** (Pages es gratis en repos públicos; en privados hace
   falta plan de pago).
4. **No** marques "Add a README", ni .gitignore, ni licencia: el repo ya los
   tiene y crearían conflictos.
5. Pulsa **Create repository**.

### 2.2 Enlazar tu copia local con ese repositorio

En la carpeta del proyecto (`/home/homelab/chino-app`):

```sh
git remote add origin https://github.com/<usuario>/chino-app.git
git branch --show-current        # dice si tu rama es master o main
git push -u origin master        # si la rama es master
# o, si tu rama es main:
git push -u origin main
```

GitHub te pedirá usuario y **token** (no la contraseña): Settings → Developer
settings → Personal access tokens → Fine-grained token con permiso *Contents:
Read and write* sobre ese repo. (O usa `gh auth login` si tienes la CLI.)

### 2.3 Activar Pages con "GitHub Actions" como fuente

1. En el repo: **Settings** → **Pages** (menú izquierdo).
2. En *Build and deployment* → **Source**, elige **GitHub Actions**
   (no "Deploy from a branch").
3. Guarda. No hay que elegir rama ni carpeta: el workflow
   `.github/workflows/pages.yml` ya trae el build y el deploy.

### 2.4 Lanzar el despliegue

- Cualquier `git push` a `master` (o `main`) dispara el workflow.
- Si acabas de activar Pages y no quieres esperar a un commit nuevo: pestaña
  **Actions** → workflow **"Deploy to GitHub Pages"** → **Run workflow**
  (existe el disparador manual `workflow_dispatch`).
- El workflow hace: `npm test` (471 tests) → `sh scripts/build-pages.sh`
  (build a `dist-pages/`, que es `OUT_DIR=dist-pages node scripts/build.mjs`
  + copia de `CREDITS.md`) → sube el artefacto → despliega.

### 2.5 La URL final

```
https://<usuario>.github.io/chino-app/
```

Aparece también en Settings → Pages y en el job de deploy ("page_url"). La
primera vez tarda un par de minutos; después, ~30 s por push.

### 2.6 Cómo actualizar la app

```sh
git add <archivos>
git commit -m "lo que cambies"
git push
```

Eso es todo: el push vuelve a correr tests + build + deploy. Si el workflow
falla, la web sigue mostrando la versión anterior (GitHub no despliega un
artefacto roto).

**Probar el build en local antes de subir** (mismo comando que el CI):

```sh
sh scripts/build-pages.sh
node scripts/serve.mjs dist-pages     # imprime el puerto; abre esa URL
```

---

## 3. Qué hace el workflow (`.github/workflows/pages.yml`)

- Se dispara con `push` a `main` **o** `master`, y a mano (`workflow_dispatch`).
- Node 20 (`actions/setup-node@v4`).
- Job `test`: `npm test`. El job `deploy` depende de él (`needs: test`), así que
  **un test roto no despliega**.
- Job `deploy`: `sh scripts/build-pages.sh` → `actions/upload-pages-artifact@v3`
  (`path: dist-pages`) → `actions/deploy-pages@v4`, con el environment
  `github-pages` (de ahí sale la URL).
- Permisos: `pages: write` e `id-token: write` (más `contents: read`).
- `concurrency: pages` con `cancel-in-progress`: dos pushes seguidos no se
  pisan.

---

## 4. Estado de la verificación en subdirectorio (importante)

GitHub Pages sirve el sitio en un **subdirectorio** (`/<repo>/`), así que se
probó exactamente eso: build a `dist-pages`, copiado a
`/tmp/…/subsite/chino-app/`, servido con `node scripts/serve.mjs` y abierto en
Chromium headless en `http://localhost:<puerto>/chino-app/`.

**Funciona** ✅

- La app carga (Home), las rutas hash navegan (`#/dictionary`, `#/learn/*`,
  `#/read`, `#/review`, `#/extras`).
- Service worker registrado con el scope correcto:
  `getRegistrations()[0].scope === "http://localhost:<puerto>/chino-app/"`,
  controller = `…/chino-app/sw.js`.
- `manifest.webmanifest` (200) y los iconos (200) con rutas relativas
  (`./manifest.webmanifest`, `./icons/icon-192.png`, `start_url: "./"`).
- Datos que ya usan URLs relativas al módulo cargan sin 404:
  `data/lessons/hsk1/index.json`, `data/hsk/1.json`, `data/achievements.json`,
  `data/grammar/index.json`, trazos.
- **Offline**: tras la primera carga, con la red cortada (CDP
  `Network.emulateNetworkConditions offline`) la app vuelve a arrancar desde la
  caché del SW (`chino-shell-<hash>`, `chino-data-<hash>`) y navega.

**Bloqueado** ❌ — rutas **absolutas** `/data/...` (dan 404 bajo `/chino-app/`)

Estos archivos resuelven los datos contra la **raíz del origen**
(`http://localhost:<puerto>/data/...`), no contra el subdirectorio. Comprobado
en el navegador: `fetch('/data/dict/index-english/h.json')` → **404**;
`fetch('./data/dict/index-english/h.json')` → **200**. Consecuencia real en la
UI: el diccionario responde *"No results for "hello""* y la pantalla Read
*"Could not load the reading."*

| Archivo:línea | Código | Qué rompe |
| --- | --- | --- |
| `src/dictionary.js:27` | `const BASE = '/data/dict'` | búsqueda del diccionario (`search`/`lookup` devuelven `[]`/`null`) |
| `src/reading/data.js:8` | `const BASE = '/data/readings/hsk1'` | pantalla Read completa |
| `src/learn/sentences.js:11` | `const BASE = '/data/sentences'` | lección de frases |
| `src/extras/paste.js:96` | `fetch('/data/hsk/1.json')` | Pegar y analizar |
| `src/learn/games/matching.js:113`, `timed.js:141`, `memory.js:128` | `fetch('/data/hsk/1.json')` | los 3 juegos |

Arreglo = **una línea por archivo**, con el patrón que ya usan los demás módulos
(p. ej. `src/learn/strokes.js:54`):

```js
// antes
const BASE = '/data/dict';
// después
const BASE = new URL('../../data/dict/', import.meta.url);
```

Esos 6 archivos son de otras tareas, así que **no los he tocado**: la tarea
quedó bloqueada pidiendo que los arreglen sus dueños (o que me autoricen a
hacerlo). Hasta entonces, **publicar en `/<repo>/` deja el diccionario, el
lector, las frases y los juegos sin datos** (el resto de la app sí funciona).
En la raíz de un dominio propio (`https://tudominio.com/`) las rutas absolutas
sí funcionarían, pero no es el caso de GitHub Pages de proyecto.

### Licencias / CREDITS.md

- `node scripts/build.mjs` **no** copia `CREDITS.md` al sitio (solo copia
  `index.html`, `src/` y `public/`).
- `scripts/build-pages.sh` **sí** lo copia, así que en el sitio publicado está
  accesible en `https://<usuario>.github.io/chino-app/CREDITS.md` (ruta directa;
  no hay enlace dentro de la app porque el shell no es de esta tarea). Si
  prefieres que `npm run build` también lo copie, el sitio natural es
  `scripts/build.mjs`.

---

## 5. Comprobar que quedó bien

1. `https://<usuario>.github.io/chino-app/` abre y se puede instalar como PWA.
2. `https://<usuario>.github.io/chino-app/CREDITS.md` responde.
3. DevTools → Application → Service Workers: scope `…/chino-app/`.
4. DevTools → Network, busca algo en el diccionario: no debe haber 404 de
   `/data/...` (esto es lo que falla hoy, ver §4).
5. DevTools → Network → *Offline* + recarga: la app sigue abriendo.

---

## 6. Plan B: Cloudflare Pages (si GitHub Pages no convence)

Gratis, sin límite de builds y con el mismo build estático. Límites que importan:
**20.000 archivos** y **25 MiB por archivo** → el sitio actual (547 archivos,
máx. 329 KiB) entra holgado.

Pasos: cuenta en <https://dash.cloudflare.com> → **Workers & Pages** → *Create*
→ **Pages** → *Connect to Git* → repo `chino-app` → Build command
`sh scripts/build-pages.sh`, Build output directory `dist-pages`, variable
`NODE_VERSION=20` → Save and Deploy. La URL es
`https://chino-app.pages.dev/` (raíz, no subdirectorio) y cada push despliega.

---

## 7. Referencias

- GitHub Pages: límites y uso — <https://docs.github.com/pages/getting-started-with-github-pages/github-pages-limits>
- Deploy con Actions (plantilla oficial) — <https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>
- Cloudflare Pages: límites — <https://developers.cloudflare.com/pages/platform/limits/>
