# Revisión de calidad thermo-nuclear, ronda 5 (delta): chino-app

- **Base revisada:** `HEAD` = `c7291d1`. El delta va desde el informe anterior (`af339f9`, REVIEW-4) hasta `HEAD`: 9 commits y 175 archivos (136 de datos regenerados).
  - `git log -1 --format=%H -- docs/REVIEW-4.md` devuelve `af339f9`. Esta vez el corrector no tocó el informe (M9 de REVIEW-4 cumplido).
- **Revisor:** opus (tarea t_a0f64a5b). Solo lectura. El único archivo nuevo es este informe.
- **Método:**
  - Leí el delta completo de `src/`, `sw.js`, `scripts/` y `tests/`, y el código de cada hallazgo de REVIEW-4.
  - Copia limpia con `git archive HEAD`. Allí pasé `npm test`, `check-i18n`, `check-es-data`, `validate-dict-es` y el build.
  - Regeneré los datos en la copia: `npm run data:dict-es` y `npm run data`.
  - Sondas de búsqueda con los datos reales y un fetch que cuenta peticiones y bytes: 28 consultas en es y en.
  - Sonda del service worker con `caches` y `fetch` falsos: un `cache.put` que falla.
  - 19 pruebas de mutación en la copia: se revierte la línea del arreglo y se pasa `npm test`.
  - Las tareas madre t_efce5444 (checks mecánicos) y t_93c2e7dc (visual en Chrome, es/en, claro/oscuro) dieron todo en verde sobre este mismo commit.

## Veredicto: **NO APROBADO para publicar**

**Sin críticos.** Queda **1 importante** abierto, y es nuevo: lo trajo la corrección de M1.

- Los 3 importantes de REVIEW-4 (I1, I2, I3) están corregidos de verdad. Cada uno tiene tests de comportamiento que mueren al revertir el arreglo.
- **I1 (nuevo):** el arreglo de M1 encadena `cache.put` en la respuesta de los datos. Si el `put` falla (cuota llena), la página recibe un error de red aunque la red haya respondido bien. Antes el fallo del `put` no afectaba a la respuesta.

La corrección es de una línea, más un test.

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` (copia limpia) | 997/997 en verde (3,8 s) |
| `check-i18n` | OK, 957 claves traducidas |
| `check-es-data` | 114 archivos, 0 errores |
| `validate-dict-es` | 115 shards, 125 427 entradas, 0 errores, 762 avisos |
| `npm run data:dict-es` en la copia | `diff -rq` con `public/data`: 0 diferencias |
| `npm run data` en la copia | Solo cambia `generatedAt` en `manifest.json` |
| build (`OUT_DIR=… node scripts/build.mjs`) | OK, 2003 archivos, `DATA_CACHE = 'chino-data-06a7e3224b7f'`. El hash coincide con el de `public/data`, no con el de un directorio vacío |
| Precache del SW | Sin `dict`, `es/dict`, `search-es` ni `strokes`. Lecturas, lecciones, gramática y temas en es/en |
| `files.json` frente a los tamaños reales | 796 archivos, 0 desfasados |
| Mutaciones (19) | Mueren 14 y sobreviven 5. Ver M1, M4 y M5 |
| Archivos de código > 1000 líneas | Ninguno. El mayor es `src/learn/dictation.js`, con 774 (`VERIFICATION.md` tiene 2232, ver M9) |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| `git status --short` | vacío |

### Sondas de búsqueda (datos reales)

| consulta | es: peticiones / MB | es: top | en: top |
|---|---|---|---|
| `wo` | 8 / 0,80 | **我** 窝 沃水 | **我** 窝 倭 |
| `hao` | 14 / 1,65 | 号 **好** 浩然 | 号 **好** 号 |
| `ren` | 10 / 1,20 | **人** 任安 任 | **人** 亻 仁 |
| `pan` | 12 / 1,58 | **面包** 泛 畔 | — |
| `mi` | 12 / 1,50 | 我 米 眯 | — |
| `casa` | 10 / 1,50 | **家** 屋子 家宅 | — |
| `agua` | 10 / 1,37 | **水** 和 汤 矿泉水 (solo 4) | — |
| `comer` | 10 / 1,50 | **吃** 食 餐 | — |
| `shi` | 14 / 1,82 | **浉** 十 是 (M2) | 十 是 是 |
| `guo` | 12 / 1,39 | **虢** 过 锅 (M2) | 过 锅 过 |
| `zhong` | 14 / 1,60 | 种 重 管子 … 中 en el puesto 7 (M8) | 种 重 种 㐺 中 |
| `dog` | **17 / 2,20** | 周狗 吉娃娃 … (M8) | — |
| `hello` / `water` | 4 / 0,44 | 凯蒂猫 / 施耐庵 (M9) | — |

Todas las consultas del presupuesto de I1 (`pan`, `wo`, `hao`, `mi`) quedan en 14 peticiones o menos y por debajo de 2 MB. Antes eran 20-26 peticiones y 2-3 MB.

## Reglas para quien corrige

- Regla del bucle: el veredicto solo es APROBADO con 0 críticos y 0 importantes abiertos. Los menores no bloquean.
- Las líneas son de `c7291d1`. Si se mueven, búscalas con el `grep -n` indicado.
- No edites `docs/REVIEW-*.md`. Las notas del corrector van en el comentario de la tarea.
- El importante debe dejar **un test de comportamiento** que falle al revertir el arreglo. No vale un `assert.match` sobre el fuente.
- Al final pasa `npm test`, `node scripts/check-es-data.mjs`, `node scripts/validate-dict-es.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

### I1. SW: si `cache.put` falla, la página recibe un error de red aunque la red respondió (regresión de M1)
- **Dónde:** `sw.js:61` (`grep -n "cache.put(request, response.clone())).then" sw.js`), dentro de `dataStrategy` (`sw.js:54-71`).
  ```js
  return cachePromise.then((cache) => cache.put(request, response.clone())).then(() => response);
  })
  .catch(() => null);
  ```
- **Qué pasa:**
  - Para que `waitUntil` se llame a tiempo (M1 de REVIEW-4), el `put` ahora va dentro de la promesa `network`, y la respuesta a la página espera a esa promesa.
  - Si `put` rechaza, el `.catch(() => null)` convierte toda la cadena en `null`. Con la caché vacía para esa URL, la página recibe `Response.error()`.
  - Medido con `caches` y `fetch` falsos (`put` lanza `QuotaExceededError`): con `c7291d1` la página recibe el error. Con `af339f9` recibe la respuesta de la red.
  - El test de M1 (`tests/review2-critical.test.mjs`, «M1: the SW hands the refresh…») usa un `put` que siempre funciona, así que no lo ve.
- **Por qué importa:**
  - Un `put` falla sobre todo por cuota llena. Esta app sí puede llenarla: la conversación en el dispositivo guarda unos 1 GB de pesos de WebLLM en la Cache API (`src/chat/webllm-provider.js:6`). En navegadores con poca cuota por origen (Safari antiguo, móviles con poco disco), a partir de ahí falla cada shard, lección o lectura que no esté en caché.
  - El usuario ve «sin conexión» con la red funcionando, y no se arregla solo.
  - Antes de M1 la respuesta no dependía del `put`. Es una regresión que trajo la corrección.
- **Corrección (1 línea):** que un fallo del `put` no anule la respuesta. En `sw.js:61`:
  ```js
  return cachePromise.then((cache) => cache.put(request, response.clone())).then(() => response, () => response);
  ```
  No cambies el resto: `waitUntil(network)` sigue cubriendo el `put` y se sigue llamando de forma síncrona.
- **Cómo comprobar:** añade un test en `tests/review2-critical.test.mjs` junto al de M1, con el mismo arnés de `new Function(...)`:
  1. `caches.open` devuelve `{ put: async () => { throw new Error('quota'); } }` y `caches.match` devuelve `null`. La promesa pasada a `respondWith` debe resolverse con el objeto que devolvió `fetch`, no con `Response.error()`.
  2. Con un `put` que resuelve tras un `setTimeout`, la promesa pasada a `waitUntil` no debe resolverse antes que el `put`. Así también muere la mutación «sacar el `put` de la cadena», que hoy sobrevive.

  Revertir el arreglo (quitar `, () => response`) debe hacer fallar el caso 1.

---

## MENORES
Corregir si cuestan 1-5 líneas. Si no, anotarlos.

### M1. `searchPinyin`: el parámetro `mixed` es un modo que sobra
- **Dónde:** `src/dictionary.js:272` (firma) y `:296-297`:
  ```js
  const hskScore = e.hsk ? 10 - e.hsk : 0;
  if (ek === key) out.push({ e, score: mixed ? (e.hsk ? 2000 - e.hsk : 100) : 100 + hskScore });
  ```
- **Qué pasa:**
  - Hay dos escalas de puntuación según un indicador. La escala sin `mixed` (109…104 para HSK, 100 sin HSK, 70 o menos para prefijo) da el mismo orden que la escala con `mixed` (1999…1994, 100, 70 o menos).
  - El resultado sin `mixed` nunca se mezcla con otra fuente: `search()` lo usa solo (`:425`). Así que el indicador no cambia ningún resultado.
  - Además, la mutación `const hskScore = 0` sobrevive a `npm test`: la rama sin `mixed` no tiene test propio de la señal HSK.
- **Corrección:** borra `mixed` y `hskScore`, y deja una sola fórmula: `if (ek === key) out.push({ e, score: e.hsk ? 2000 - e.hsk : 100 });`. En `:421` llama a `searchPinyin(q, { maxShards: 2 })`.
- **Comprobar:** `npm test` en verde. Después, `score: 100` en esa línea debe hacer fallar los tests I1 de es **y** de en de `tests/dict-es-real.test.mjs`.

### M2. Búsqueda ES: un nombre propio «Shi, …» gana a 是/十 porque `exactDef` corta también por comas
- **Dónde:** `src/dictionary.js:387` (`.split(/[;,]/)`).
- **Qué pasa:** CC-CEDICT escribe muchos nombres propios como «Shi, name of river…», y la traducción mantiene la coma. El tramo «Shi» es igual a la consulta y la entrada sube al tramo 3000, por encima del pinyin HSK (2000). Resultado: `shi` → 浉 #1 y `guo` → 虢 #1 en locale es.
- **Corrección:** corta solo por `;`, que es el separador de sentidos que usa la propia corrección de I2 («hogar; casa»): `.split(';')`.
- **Comprobar:** lo probé en la copia. `npm test` sigue 997/997. `shi` → 十 是 是 浉; `guo` → 过 锅 过; y `casa`, `agua`, `pan`, `comer`, `mi`, `te` y `fan` no cambian. Añade a `tests/dict-es-real.test.mjs` que `shi` en es tenga 是 o 十 en el puesto 1.

### M3. `DATA_VERSION`: no cubre los índices de `dict/`, que el SW también sirve cache-first
- **Dónde:** `scripts/lib/data-version.mjs:18-23` y `sw.js:48` (`isImmutableData`).
- **Qué pasa:**
  - `isImmutableData` casa con todo `/dict/`: shards, `index-pinyin/`, `index-english/`, `index-hanzi*.json` y `manifest.json`. `DATA_SOURCES` solo incluye `dict/shards`. El comentario de `:15-17` dice «every piece of data the service worker serves cache-first», y no es cierto.
  - Hoy funciona porque los índices se derivan de los shards: el orden HSK de `index-pinyin` va con el campo `hsk` de los shards. Pero un cambio que solo toque el generador del índice (por ejemplo, el comparador de `build-data.mjs`) no rotaría la caché, y quien ya tiene el índice viejo lo conservaría para siempre.
  - `hashTree` (`:49`) ignora sin avisar un directorio que falta. Un build sin datos daría siempre el hash vacío `e3b0c44298fc`.
  - La alternativa `search` del regex de `sw.js:48` no existe en `public/data`.
- **Corrección:** cambia `['dict/shards', 'dir']` por `['dict', 'dir']`. En `dataCacheVersion`, cuenta los archivos y lanza un error si son 0. Opcional: quita `search|` del regex.
- **Comprobar:** en el test I7/M2 de `review2-critical.test.mjs`, añade `dict/index-pinyin/a.json` a `sources`. Un directorio vacío debe hacer lanzar `dataCacheVersion`.

### M4. La lógica de los scripts de datos no tiene test y CI no detecta datos desfasados
- **Dónde:** `scripts/build-dict-es-index.mjs:115` (prefijo exacto de I2), `scripts/fix-dict-es.mjs:204-217` (`DEF_OVERRIDES`) y `scripts/build-data.mjs:286-290` (`pinyinRank`).
- **Qué pasa:** revertir cualquiera de los tres sobrevive a `npm test`. Los tests leen los datos commiteados, no los regeneran. Solo los protege que alguien vuelva a generar los datos y mire el diff, y CI no lo hace (M6 de REVIEW-3, abierto: `.github/workflows/pages.yml:33`).
- **Corrección:** la más barata es la de REVIEW-3 M6: en CI, `npm run data:dict-es && git diff --exit-code public/data`. Alternativa: un test de `buildSearchIndex` con una entrada «casado» y otra «casa», que exija que solo la segunda tenga `exact`.
- **Comprobar:** revertir `:115` de `build-dict-es-index.mjs` hace fallar el test o el paso de CI.

### M5. Sync: falta el caso «borrado durante el push no resucita» (M5 de REVIEW-4 a medias)
- **Dónde:** `tests/sync-convergence.test.mjs:447-463`.
- **Qué pasa:** ya está el caso de reescribir una clave del lote (`settings/theme`), y la mutación `return false` del filtro de la cola muere. Falta borrar una clave del lote con el POST retenido.
- **Corrección:** en el mismo test, con el POST retenido, `A.store.remove('srs', <clave del lote>)`. Tras `release()` y un segundo `syncNow`, el servidor debe tener la fila marcada como borrada, no la versión anterior.

### M6. Comentarios con números de informe: el delta añade 10 más
- **Dónde:** `grep -rno "REVIEW-[0-9]" src sw.js scripts | wc -l` da 56. El delta añade 10 (`(REVIEW-4 I1)`, `(REVIEW-4 M3)`…), aunque M7 de REVIEW-4 pedía dejar el número para el mensaje del commit.
- **Corrección:** en los comentarios nuevos, deja el porqué y borra la referencia `(REVIEW-N …)`. No hace falta limpiar los antiguos de una vez.

### M7. Tests: casos de la conversación que REVIEW-4 citaba y siguen sin cubrir
- **Qué pasa:** los cinco casos que pedía I3 están cubiertos y mueren al revertir. Sigue sin test el premio diario repetido (`src/extras/conversation.js:492-500`, `conversationRewardDay`). El test de aborto exige que no se guarde un mensaje con `{`, pero no que no se guarde un `zh` vacío o parcial.
- **Corrección:** en el test de aborto, exige `history.length` igual al de antes de enviar. Añade un test que envíe 5 mensajes dos veces en el mismo día y cuente un solo `chino:lesson_done`.

### M8. Búsqueda ES: rutas de reserva pesadas y pocos resultados (M4 de REVIEW-4, abierto)
- **Qué pasa:**
  - `agua` sigue con 4 resultados (`ES_MAX_SHARDS = 4`, `src/dictionary.js:346`).
  - `dog` en locale es hace 17 peticiones y 2,20 MB. En REVIEW-4 eran 2,07 MB: los shards crecieron un poco con el campo `hsk`.
  - Los aciertos españoles no exactos (tramo 1000) ganan al pinyin exacto sin HSK (tramo 100). Por ejemplo, `zhong` → 管子 (por «Guan Zhong») delante de 中, que queda en el puesto 7.
- **Corrección:** la de REVIEW-4 M4 (vista previa en las postings). Para `zhong`, basta con que el pinyin exacto sin HSK puntúe por encima de los aciertos españoles no exactos cuando la consulta no tiene acierto exacto en español. Es opcional.

### M9. Abiertos de rondas anteriores (detalle en `docs/REVIEW-3.md` y `docs/REVIEW-4.md`)
Sin cambios en esta ronda. Lo comprobé con `grep`:
- **Sin CSP:** `grep -rn Content-Security-Policy index.html deploy` da vacío.
- **Enlace a CREDITS en Ajustes:** `grep -n CREDITS src/extras/settings.js` da vacío.
- **Install con precache incompleto:** `sw.js:28` sigue con `Promise.allSettled`.
- **CI que repara antes de validar:** `pages.yml:33`, sin `git diff --exit-code` (ver M4).
- **Scripts de muestreo en git:** `git ls-files scripts | grep -c sample` da 2.
- **`lang` y reduced-motion en la hoja de trazos:** abiertos.
- **Documentación:** `src/chat/webllm-provider.js:6` dice «works offline» y `VERIFICATION.md` tiene 2232 líneas.
- **Ruta absoluta en `scripts/check-exercises.mjs:40`** y sin `devDependencies` para puppeteer.
- **Opener en inglés:** `src/chat/prompts.js:34-38`.
- **Inglés en locale es:** `hello` → solo 凯蒂猫, `water` → 施耐庵.
- **Menores de REVIEW-2:** sin cambios. Lo más relevante antes de activar sync: el historial de la conversación vive en `settings`, que se sincroniza.
- **Duplicado `try { await saveProgress(...) }`** en `lessons.js` y `tones.js`.

---

## Lo que está bien (verificado en esta ronda)

- **I1 de REVIEW-4, pinyin sin tonos:**
  - `hsk` va en cada entrada de los shards. El tamaño del shard se mide sin ese campo, así que la numeración que comparten los shards ES no se mueve: `check-es-data` y `validate-dict-es` dan 0 errores.
  - `index-pinyin` pone primero los shards con entradas HSK. La rama mezclada pide como mucho 2 shards de pinyin y puntúa por tramos.
  - `wo`, `hao` y `ren` tienen 我, 好 y 人 en el top 3, en es y en en. Las consultas del presupuesto quedan en 8-14 peticiones y por debajo de 2 MB.
  - Las mutaciones `maxShards`, tramo `exactDef` y tramo HSK de la rama mezclada mueren.
  - `npm run data` reproduce los datos: solo cambia `generatedAt`.
- **I2 de REVIEW-4, «casa»:** 家 #1. La traducción se añade por `DEF_OVERRIDES` en `fix-dict-es.mjs`, no a mano: `npm run data:dict-es` da 0 diff. El prefijo exacto ya no acierta con «casado». `agua`, `pan`, `árbol`, `año` y `café` siguen bien.
- **I3 de REVIEW-4, tests de la conversación:**
  - Hay un arnés `mountConversation` y tests de select (mira `body.model`), stream sin `{`, aborto, error sin mensaje huérfano, «solo clave API» y Frases sin red.
  - Las cinco mutaciones que pedía REVIEW-4 mueren: `reloadProviders` del select, filtro del stream, guarda del aborto, borrado del huérfano y `try` de `sentences.js`.
  - Los `assert.match` cubiertos se borraron de `review2-critical.test.mjs`.
- **M1:** `waitUntil` se llama de forma síncrona y antes de `respondWith`, y el test con `event` falso muere al cambiar el orden. Pero trajo I1.
- **M2:** `DATA_SOURCES` incluye shards EN, shards ES, `search-es` y `strokes`, y se calcula sobre `dist/data`. El test cambia un byte de cada fuente por separado. Quitar `strokes` o `dict/shards` hace fallar el test. Quedan los índices (M3).
- **M3:** el router enfoca el slot si la pantalla no lo hizo. El test muere al quitarlo.
- **M6:** `afterEach` restaura `location` en `router.test.mjs` y borra las claves de la conversación en `review3-critical.test.mjs`.
- **M8:** `files.json` coincide con los 796 archivos.
- **M9:** el corrector no tocó los informes. La base del delta sale bien.
- **Seguridad:** el delta no toca `src/secrets.js`, backup, el filtro de secretos de sync ni `deploy/`. No hay `innerHTML` ni `html:` nuevos. Las claves de prueba (`sk-test`) solo están en tests y se borran al acabar.
- **Licencia CC BY-SA:** `es/dict/LICENSE.md` y `CREDITS.md` sin cambios, y los dos llegan al build.
- **Sin conexión y precache:** el precache no incluye datos pesados. Lecturas, lecciones, gramática y temas siguen en el precache.
- **Higiene:** 0 coautores, `git status` vacío, ningún archivo de código de más de 1000 líneas y sin `dist/` ni `.cache/` en git.

---

## Estado de los hallazgos de `docs/REVIEW-4.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| I1 | Pinyin mezclado en es: ranking y presupuesto | **Corregido de verdad** | 我/好/人 en el top 3 en es y en. 8-14 peticiones y menos de 2 MB. 3 mutaciones mueren. Queda el modo `mixed` sobrante (M1) |
| I2 | «casa» sin 家 | **Corregido de verdad** | 家 #1 por `DEF_OVERRIDES`. 0 diff al regenerar. Prefijo corregido, sin test unitario (M4) |
| I3 | Tests de la conversación | **Corregido de verdad** | 7 tests DOM. Las 5 mutaciones pedidas mueren. Faltan el premio diario y el `zh` parcial en el aborto (M7) |
| M1 | `waitUntil` tardío | **Corregido, con regresión** | Orden síncrono con test. El `put` encadenado rompe la respuesta si falla (I1 nuevo) |
| M2 | `DATA_VERSION` incompleto | **Corregido** | 4 fuentes sobre `dist`. Faltan los índices de `dict/` (M3) |
| M3 | Foco tras navegar | **Corregido de verdad** | Router con test que muere |
| M4 | `agua` con 4 resultados y rutas pesadas | **Abierto** | `dog` 17 pet. / 2,20 MB (M8) |
| M5 | Sync: misma clave durante el push | **Parcial** | Reescritura cubierta y mutación muerta. Falta el borrado (M5) |
| M6 | Estado global en tests | **Corregido de verdad** | `afterEach` en los dos archivos |
| M7 | Comentarios con números de informe | **Parcial** | Se quitó el de `ES_MAX_SHARDS`, pero el delta añade 10 (M6) |
| M8 | `files.json` desfasado | **Corregido de verdad** | 0 desfasados |
| M9 | El corrector editó el informe | **Corregido de verdad** | REVIEW-4 intacto |
| M10 | Menores de REVIEW-3 | **Abierto** | Sin cambios (M9) |

Resumen de la tabla (13): 9 corregidos (7 de verdad, 1 con un resto menor y 1 con regresión), 2 parciales y 2 abiertos, todos menores.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** 1 (I1, nuevo y de una línea).
- **Menores:** 9 (M1-M9; M9 agrupa lo que sigue abierto de rondas anteriores).
- **Orden recomendado:**
  1. I1: `, () => response` en `sw.js:61` y los dos casos de test.
  2. M2 (`split(';')`) y M1 (borrar `mixed`): una línea cada uno, con test.
  3. M3 (`['dict','dir']` y error con 0 archivos) y M4 (`git diff --exit-code` en CI).
- **Los 3 más importantes:**
  1. **I1:** con la cuota llena (por ejemplo, tras bajar el modelo de WebLLM de ~1 GB), cada dato que no esté en caché llega a la página como error de red con la red funcionando. Lo trajo el arreglo de M1 y se corrige con una línea.
  2. **M2:** en es, `shi` y `guo` ponen primero un río y un estado antiguo (浉, 虢) en lugar de 是/十 y 过, porque `exactDef` corta también por comas. `split(';')` lo arregla sin romper ningún test.
  3. **M3 + M4:** los índices de `dict/` no entran en la versión de la caché, y la lógica de los scripts de datos solo la protege una regeneración manual que CI no comprueba.
