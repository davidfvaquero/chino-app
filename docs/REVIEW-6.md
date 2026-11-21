# Revisión de calidad thermo-nuclear, ronda 6 (delta): chino-app

- **Base revisada:** `HEAD` = `ed74ed9`. El delta va desde el informe anterior (`94a69e3`, REVIEW-5) hasta `HEAD`: 8 commits y 14 archivos (código: `sw.js`, `src/dictionary.js`, `scripts/lib/data-version.mjs`, `.github/workflows/pages.yml`; el resto, comentarios y tests). Sin cambios de datos.
  - `git log -1 --format=%H -- docs/REVIEW-5.md` devuelve `94a69e3`. El corrector no tocó los informes.
- **Revisor:** opus (tarea t_540045f5). Solo lectura. El único archivo nuevo es este informe.
- **Método:**
  - Leí el delta completo y el código de cada hallazgo de REVIEW-5.
  - Copia limpia con `git archive HEAD`: `npm test`, `check-i18n`, `check-es-data`, `validate-dict-es` y el build.
  - Simulé el paso nuevo de CI en un `git clone` limpio: `npm run data:dict-es && git diff --exit-code public/data`. También con el arreglo de I2 de REVIEW-4 revertido.
  - 10 pruebas de mutación en la copia (se revierte la línea del arreglo y se pasa `npm test`).
  - Sondas de búsqueda en locale es con los datos reales, 37 consultas, comparando `94a69e3` con `HEAD`.
  - Las tareas madre t_0c673587 (checks mecánicos) y t_025c8a5d (visual en Chrome, es/en, claro/oscuro) dieron todo en verde sobre este mismo commit.

## Veredicto: **APROBADO para publicar**

**Sin críticos. Sin importantes.** Quedan 4 menores, que no bloquean.

- El importante de REVIEW-5 (I1: un `cache.put` fallido tumbaba la respuesta) está corregido de verdad. Tiene dos tests de comportamiento, y las dos mutaciones (quitar el manejador de rechazo y sacar el `put` de la cadena) mueren.
- De los menores de REVIEW-5, M1-M6 están corregidos de verdad. M7 está **a medias**: el test nuevo del premio diario no pulsa «Nueva conversación» y pasa aunque se quite la guarda (ver M1 de este informe).
- El delta no introduce regresiones: los resultados de búsqueda solo cambian en `shi`, `guo` y `li`, y los tres a mejor.

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` (copia limpia) | 1002/1002 en verde (3,7 s) |
| `check-i18n` | OK, 957 claves traducidas |
| `check-es-data` | 114 archivos, 0 errores |
| `validate-dict-es` | 115 shards, 125 427 entradas, 0 errores, 762 avisos |
| Paso de CI nuevo en un clon limpio | `data:dict-es` sale con 0 y `git diff --exit-code public/data` también (0 diferencias) |
| El mismo paso con el prefijo exacto de `build-dict-es-index.mjs:115` revertido | `git diff` cambia 21 archivos de `search-es` y sale con 1: CI lo detecta |
| build (`OUT_DIR=… node scripts/build.mjs`) | OK, 2003 archivos, `DATA_CACHE = 'chino-data-002ad218a559'` |
| Precache del SW | 228 entradas `data/`, ninguna de `dict`, `es/dict`, `search-es` ni `strokes` |
| Licencia CC BY-SA en el build | `data/es/dict/LICENSE.md` y `CREDITS.md` presentes |
| Mutaciones (10) | Mueren 9 y sobrevive 1 (guarda del premio diario, ver M1) |
| Archivos de código > 1000 líneas | Ninguno. El delta no hace crecer ninguno de forma notable (`src/dictionary.js` 533) |
| Referencias `REVIEW-N` añadidas por el delta | 0 (quedan 43 antiguas en `src`, `sw.js` y `scripts`; antes 56) |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| `git status --short` | vacío |

### Mutaciones

| Mutación | Resultado |
|---|---|
| `sw.js:65` sin `, () => response` | muere (I1, caso 1) |
| `sw.js:63-65` con el `put` fuera de la cadena | muere (I1, caso 2) |
| `src/dictionary.js:388` de vuelta a `.split(/[;,]/)` | muere (M2) |
| `src/dictionary.js:296` con `score: 100` | mueren 2 tests (M1) |
| `data-version.mjs:20` de vuelta a `dict/shards` | muere (M3) |
| `data-version.mjs:45` sin el `throw` | muere (M3) |
| `conversation.js:484` sin la guarda de aborto | muere (M7) |
| `conversation.js:506` sin el `pop` del mensaje huérfano | muere (M7) |
| `sync/client.js:285` con `return false` | mueren 2 tests (M5) |
| `conversation.js:495` con `if (true)` (sin guarda del día) | **sobrevive** (M1 de este informe) |

### Sondas de búsqueda en es (datos reales, `HEAD`)

Solo cambian tres consultas respecto a `94a69e3`:

| consulta | antes | ahora |
|---|---|---|
| `shi` | 浉 十 是 | **十 是** 是 浉 |
| `guo` | 虢 过 锅 | **过 锅** 过 虢 |
| `li` | 里 里 里 离 | 里 里 离 里 |

Las otras 34 siguen igual. Por ejemplo: `casa` → 家, `agua` → 水, `pan` → 面包, `comer` → 吃, `perro` → 狗, `libro` → 书, `amigo` → 朋友 y `hoy` → 今天. Todas quedan en 14 peticiones o menos y por debajo de 2 MB.

## Reglas para quien corrige

- El veredicto ya es APROBADO. Los menores son opcionales: corrige los que cuesten 1-5 líneas y anota el resto.
- Las líneas son de `ed74ed9`. Si se mueven, búscalas con el `grep -n` indicado.
- No edites `docs/REVIEW-*.md`. Las notas del corrector van en el comentario de la tarea.
- Al final pasa `npm test`, `node scripts/check-es-data.mjs`, `node scripts/validate-dict-es.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

Sin importantes.

---

## MENORES

### M1. El test del premio diario no pulsa «Nueva conversación» y pasa sin la guarda (M7 de REVIEW-5 a medias)
- **Dónde:** `tests/review3-critical.test.mjs:525` (`grep -n "byText(container, CONV.newChat)" tests/review3-critical.test.mjs`) y `tests/helpers/fake-dom.mjs:143-144` (`byText`).
- **Qué pasa:**
  - `byText` devuelve el **primer** nodo cuyo `textContent` coincide. En el DOM falso, el `div.conv-row` que envuelve al botón tiene el mismo texto y va antes, así que el test hace `click()` sobre el `div`. El DOM falso no propaga eventos, y `startNewConversation` no se llama nunca.
  - Medido con trazas: la segunda ronda cuenta de 6 a 10 mensajes de usuario y nunca vuelve a 5. La condición del premio no se evalúa otra vez, y el test pasa por ese motivo, no por la guarda.
  - La mutación `if (lastDay !== day)` → `if (true)` (`src/extras/conversation.js:495`) **sobrevive** a `npm test`.
  - Es el único caso: instrumenté `byText` en toda la suite y ningún otro `click` cae en un nodo sin manejador.
- **Por qué importa:** la regla del bucle es que cada arreglo tenga un test que muera al revertirlo. Este test da una falsa garantía sobre el «no farmear el premio». El código de la guarda está bien (lo leí), pero nada lo protege.
- **Corrección (test, 2 líneas):** en `:525`, pulsa el botón de verdad y comprueba que el contador se ha reiniciado:
  ```js
  container.querySelectorAll('button').find((b) => b.textContent === CONV.newChat).click();
  await settle(dom);
  assert.equal((await storage.get('settings', 'conversationHistory')).length, 1, 'new conversation resets the history');
  ```
  Opcional: que `byText` devuelva el nodo más profundo (`findLast`) para que no vuelva a pasar.
- **Cómo comprobar:** `npm test` en verde. Después, `if (true)` en `conversation.js:495` debe hacer fallar «the daily conversation reward fires once».

### M2. El paso de CI no ve archivos nuevos y no cubre el generador del diccionario inglés
- **Dónde:** `.github/workflows/pages.yml:38` (`git diff --exit-code public/data`).
- **Qué pasa:**
  - `git diff` no muestra archivos sin seguimiento. Si un cambio en `build-dict-es-index.mjs` genera un archivo nuevo (por ejemplo, la letra de un índice que antes no existía) y nadie lo commitea, CI sigue en verde y el despliegue sale sin él.
  - `npm run data` (`build-data.mjs`, que incluye `pinyinRank`, `:288-292`) no corre en CI porque descarga fuentes. Revertir su comparador sigue sobreviviendo a `npm test` y a CI. Es el resto de M4 de REVIEW-5.
- **Corrección (1 línea):** cambia la línea 38 por `test -z "$(git status --porcelain public/data)" || { git status --porcelain public/data; exit 1; }`. Para `pinyinRank`, basta con anotarlo en el README: «tras tocar `build-data.mjs`, correr `npm run data` y commitear el diff».
- **Cómo comprobar:** en un clon, crea `public/data/search-es/zz.json` sin añadirlo a git. El paso nuevo debe salir con 1, y `git diff --exit-code` sale con 0.

### M3. Búsqueda ES: rutas pesadas y orden mejorable (M8 de REVIEW-5, abierto)
- **Dónde:** `src/dictionary.js:345` (`ES_MAX_SHARDS = 4`) y la puntuación de `searchSpanish`/`searchPinyin`.
- **Qué pasa (medido en `HEAD`):**
  - `agua` → solo 4 resultados (水 和 汤 矿泉水).
  - `café` → 咖啡屋 咖啡店 **咖啡**: la palabra básica queda la 3.ª. La verificación visual (t_025c8a5d) también lo vio.
  - `zhong` → 种 重 管子 钟繇 钟馗: 中 no está en el top 5. `hao` → 号 delante de 好. `hermano` → 大 el primero.
  - `dog` en locale es: 17 peticiones y 2,20 MB (sin cambios).
- **Corrección:** opcional. Es la de REVIEW-4 M4 (vista previa en las postings). Para `zhong` basta con que el pinyin exacto puntúe por encima de los aciertos españoles no exactos cuando la consulta no tiene acierto exacto en español. Para `café`, que a igualdad de tramo gane la definición más corta.
- **Cómo comprobar:** `search('zhong', { spanish: true })` con 中 en el top 3 y `search('café', { spanish: true })[0].simp === '咖啡'`, sin romper los tests de `tests/dict-es-real.test.mjs`.

### M4. Abiertos de rondas anteriores (detalle en `docs/REVIEW-3.md`, `docs/REVIEW-4.md` y `docs/REVIEW-5.md`)
Sin cambios en esta ronda. Lo comprobé con `grep`:
- **Sin CSP:** `grep -rln Content-Security-Policy index.html deploy` da vacío.
- **Enlace a CREDITS en Ajustes:** `grep -c CREDITS src/extras/settings.js` da 0.
- **Install con precache incompleto:** `sw.js:28` sigue con `Promise.allSettled`.
- **Scripts de muestreo en git:** `git ls-files scripts | grep -c sample` da 2.
- **`lang` y reduced-motion en la hoja de trazos:** abiertos.
- **Documentación:** `src/chat/webllm-provider.js:6` sigue con «works offline» y `VERIFICATION.md` tiene 2232 líneas.
- **Ruta absoluta de Chrome en `scripts/check-exercises.mjs:40`**, y sin `devDependencies` para puppeteer.
- **Opener en inglés:** `src/chat/prompts.js:34-38`.
- **Inglés en locale es:** `hello` → solo 凯蒂猫, `water` → 施耐庵.
- **Menores de REVIEW-2:** el historial de la conversación vive en `settings`, que se sincroniza. Hay que resolverlo antes de activar sync.
- **Duplicado `try { await saveProgress(...) }`** en `lessons.js` y `tones.js`.

Nota, fuera del repo: la verificación visual vio que la copia publicada en `:8095` (`chino-app-live/current`) solo ofrece inglés en Ajustes, y el build de `HEAD` sí trae es. Probablemente la copia es de otro commit. Al publicar, despliega desde `ed74ed9` o posterior.

---

## Lo que está bien (verificado en esta ronda)

- **I1 de REVIEW-5, SW con `put` fallido:**
  - `sw.js:63-65` cierra la cadena con `.then(() => response, () => response)`. Un fallo de `caches.open` o de `put` devuelve la respuesta de la red.
  - `waitUntil(network)` sigue llamándose de forma síncrona y sigue esperando al `put`.
  - El arnés `makeSwHarness` carga el `sw.js` real con `caches` y `fetch` falsos. Los dos casos pedidos existen y mueren al mutar.
  - La caché de datos rota una vez (`06a7e3224b7f` → `002ad218a559`) porque ahora entra todo `dict/`. Es lo esperado.
- **M1:** una sola fórmula de puntuación (`src/dictionary.js:296`). No hay otro llamador que mezcle escalas: `search()` usa el resultado sin mezclar solo en `:426`. La mutación `score: 100` mata 2 tests (es y en).
- **M2:** `.split(';')` en `:388`. Se arreglan `shi` y `guo`, y ninguna otra consulta de las 37 empeora. Hay un test nuevo que muere al revertir.
- **M3:** `DATA_SOURCES` cubre todo `dict/` (shards, índices y `manifest.json`, que no lleva marca de tiempo, así que el hash es estable). Un directorio sin datos lanza un error. Todos los directorios que casan con `isImmutableData` (`dict`, `es/dict`, `search-es`, `strokes`) entran en el hash. Las dos mutaciones mueren.
- **M4:** CI regenera el diccionario ES y falla si los datos commiteados no coinciden. Lo probé en un clon limpio, con 0 diff, y con un arreglo revertido, que sale con 1. Los scripts de ES solo leen `public/data` (no hay red ni `.cache`), así que el paso reproduce en CI. Queda lo de M2.
- **M5:** test nuevo «borrado durante el push no resucita». Retiene el POST, borra la clave y comprueba la lápida en el servidor y en local. La mutación del filtro de la cola mata 2 tests.
- **M6:** el delta no añade referencias `REVIEW-N` y quita 13.
- **M7 (parte del aborto):** `history.length === 1` tras abortar. Las mutaciones de la guarda de aborto y del `pop` del mensaje huérfano mueren.
- **Seguridad:** el delta no toca `src/secrets.js`, backup, el filtro de secretos de sync, `deploy/` ni el router (solo un comentario). No hay `innerHTML` ni `html:` nuevos. `sk-test` solo aparece en tests y se borra en `afterEach`.
- **Sin conexión y precache:** el precache no lleva datos pesados, y lecturas, lecciones, gramática y temas en es/en siguen en él.
- **Higiene:** 0 coautores, `git status` vacío, sin archivos sueltos en la raíz, sin `dist/` ni `.cache/` en git, y ningún archivo de código de más de 1000 líneas.

---

## Estado de los hallazgos de `docs/REVIEW-5.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| I1 | `cache.put` fallido tumba la respuesta | **Corregido de verdad** | `sw.js:65`. 2 tests de comportamiento y 2 mutaciones muertas |
| M1 | Modo `mixed` sobrante | **Corregido de verdad** | Una fórmula. La mutación `score: 100` mata los tests de es y de en |
| M2 | `exactDef` corta por comas | **Corregido de verdad** | `split(';')`. `shi` → 十, `guo` → 过. Test que muere |
| M3 | `DATA_VERSION` sin índices de `dict/` | **Corregido de verdad** | `['dict','dir']` y error con 0 archivos. 2 mutaciones muertas |
| M4 | Scripts de datos sin guarda en CI | **Corregido** | CI detecta un arreglo de ES revertido. No ve archivos nuevos ni `build-data.mjs` (M2) |
| M5 | Borrado durante el push | **Corregido de verdad** | Test nuevo. La mutación del filtro mata 2 tests |
| M6 | Números de informe en comentarios | **Corregido de verdad** | 0 añadidos y 13 quitados |
| M7 | Premio diario y `zh` parcial en el aborto | **Parcial** | Aborto: corregido y mutaciones muertas. Premio: el test no pulsa el botón y la mutación sobrevive (M1) |
| M8 | Búsqueda ES: rutas pesadas y orden | **Abierto** | `agua` con 4 resultados, `zhong` sin 中, `dog` 2,20 MB (M3) |
| M9 | Abiertos de rondas anteriores | **Abierto** | Sin cambios (M4) |

Resumen de la tabla (10): 7 corregidos (6 de verdad y 1 con un resto menor), 1 parcial y 2 abiertos. Todo lo que queda es menor.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** 0.
- **Menores:** 4 (M1-M4). M4 agrupa lo que sigue abierto de rondas anteriores.
- **Veredicto:** APROBADO para publicar. Despliega desde `ed74ed9` o posterior.
- **Los 3 más importantes (todos menores):**
  1. **M1:** el test del premio diario es vacío: hace clic en el `div` que envuelve al botón, y quitar la guarda del día no lo rompe. Se arregla en el test con 2 líneas.
  2. **M2:** el paso de CI usa `git diff`, que no ve archivos nuevos sin commitear, y `build-data.mjs` sigue sin guarda. Basta con cambiar a `git status --porcelain`.
  3. **M3:** calidad de la búsqueda en es: `café` pone 咖啡 el 3.º, `zhong` no muestra 中 en el top 5 y `agua` da solo 4 resultados.
