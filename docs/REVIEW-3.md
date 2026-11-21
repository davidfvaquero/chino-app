# Revisión final de calidad (thermo-nuclear, ronda 3): chino-app

- Base revisada: commit `2fc05b7`, en un clon limpio. El repo real tiene `git status` vacío.
- Revisor: opus (tarea t_b7ac6ceb). Solo lectura: no se ha tocado código, datos, tests ni configuración. El único archivo nuevo es este informe.
- Rondas anteriores: `docs/REVIEW.md` (39) y `docs/REVIEW-2.md` (4 C, 19 I, 22 M). El estado de REVIEW-2 está en la tabla final.
- Método: código de producción leído hallazgo por hallazgo. Sondas reales con Chrome headless (390×844, es/en, servidor matado para probar sin red, openrouter.ai interceptado y clave falsa). Fetch contador sobre `public/data` real. `npm run data` en una copia con `.cache`. 61 pruebas de mutación: se revierte la línea del arreglo y se pasa `npm test`.

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` | 976/976 en verde (3,7 s) |
| `check-es-data` | 114 archivos, 0 errores |
| `validate-dict-es` | 0 errores, 762 avisos (24 son colas en inglés, ver M6) |
| `check-i18n` | OK, 956 claves |
| build (`OUT_DIR=… node scripts/build.mjs`) | OK, 2028 archivos |
| Precache del SW | 181 entradas, 1,30-1,36 MB. Sin `data/dict`, `data/es/dict`, `search-es` ni `strokes`. Con las 80 lecciones |
| `check-exercises` | 8/8 en mi ejecución. Con la máquina cargada: 7/8 y 2/8 («vocabulary step did not appear»), por la recarga de I1 |
| `check-contrast` / `check-layout` | 424/424 / 156/156 |
| `check-strokes-orient` / `check-strokes-dark` | 74/74 / exit 0 (52 medidas, 0 bajo 3:1) |
| `check-worksheet-pdf` | 3 PASS y 1 **FAIL** de 4: «Execution context was destroyed, most likely because of a navigation». Es la recarga de I1 |
| `npm run data` en copia con `.cache` | 0 archivos borrados. Solo cambian `manifest.json` (fecha) y `files.json` (18 tamaños desfasados, ver I8) |
| `npm run data:dict-es` en HEAD | 1 diff (`index-spanish/e.json`, ver I8) |
| `npm run data:sentences-es` | 0 diff. Frases con 要 leído yāo: 0 en EN y 0 en ES |
| Archivos > 1000 líneas | Ninguno (el mayor es `src/learn/dictation.js`, con 774) |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| Mutaciones | 61: mueren 22 y sobreviven 39 (ver I10) |

## Veredicto: **NO APROBADO para publicar**

**Sin críticos.** Quedan 12 importantes abiertos, y 5 los han traído las propias correcciones de la ronda 2:

- recarga en la primera visita (M2 → I1);
- foco perdido (I1 de REVIEW-2 → I2);
- cambio de modelo que no se aplica (C1 → I3);
- guardado que falla y bloquea Finalizar (I2 de REVIEW-2 → I4);
- pinyin sin tonos roto en español (C2 → I5).

Las correcciones de los críticos de REVIEW-2 vuelven a estar protegidas sobre todo por regex sobre el código fuente, no por tests de comportamiento (I10).

## Reglas para quien corrige

- 🔴 = **imprescindible antes de publicar** (va primero). 🟠 = **imprescindible antes de activar sync**. Sync está apagado: `src/sync/config.js` está vacío.
- Regla del bucle: el veredicto solo es APROBADO con 0 críticos y 0 importantes abiertos. Los menores no bloquean.
- Las líneas son de `2fc05b7`. Si se mueven, búscalas con el `grep -n` indicado.
- Haz el cambio mínimo. Pasa `npm test` tras cada hallazgo. Al final pasa también `node scripts/check-es-data.mjs`, `OUT_DIR=/tmp/chino-fix node scripts/build.mjs` y `node scripts/check-exercises.mjs /tmp/chino-fix`.
- Cada arreglo 🔴 debe dejar **un test de comportamiento** (montar DOM o llamar a la función), **no** un `assert.match` sobre el fuente. Comprobación: revertir el arreglo debe hacer fallar `npm test`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

### I1. 🔴 Primera visita: la página se recarga sola a los pocos segundos y pierde lo que hizo el usuario (regresión de M2)
- **Dónde:** `src/pwa.js:40`, más `sw.js:27` (`skipWaiting`) y `sw.js:38` (`clients.claim`).
- **Qué pasa:** el listener `controllerchange → location.reload()` se registra siempre. En la primera visita no hay controlador. Al activarse el SW, `clients.claim()` lanza `controllerchange` y la página se recarga 1-3 s después de cargar. Medido en un perfil limpio: un solo `goto` produce 2 navegaciones. El clic en «Siguiente» de la lección se pierde y vuelve la intro. En la segunda visita hay 1 navegación.
- **Por qué importa:** todos los usuarios nuevos lo sufren. También vuelve inestables las comprobaciones que limpian el origen: `check-exercises` y `check-worksheet-pdf` (1 de 4 ejecuciones falla con «Execution context was destroyed… navigation»). El test de M2 (`tests/review2-critical.test.mjs:182-185`) es un regex que **fija** este comportamiento.
- **Corrección:** en `registerServiceWorker`:
  ```js
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); }, { once: true });
  ```
  Cambiar el regex por un test con un `navigator` falso: sin controlador previo, `reload` no se llama; con controlador previo, se llama 1 vez.
- **Cómo comprobar:** en un contexto limpio, `goto('#/learn/lessons/hsk1-01')` produce exactamente 1 `framenavigated`. `check-exercises` da 8/8 en dos ejecuciones seguidas.

### I2. 🔴 El nodo de ruta no admite foco: los 29 `container.focus()` no hacen nada y el foco cae en `<body>` (regresión de I1)
- **Dónde:** `src/router.js:64-69` (crea `div.route-slot` sin `tabindex`). Antes el contenedor era `<main id="screen" tabindex="-1">` (`index.html:23`). Llamadas afectadas (`grep -rn 'container.focus(' src`): `lessons.js:221,248`, `tones.js:83`, `memory.js:261`, `matching.js:253`, `timed.js:335`, `learn.js:107`, `home.js:185` y 21 más.
- **Qué pasa:** `focus()` sobre un `div` sin `tabindex` no hace nada. Sonda: `document.activeElement === body` en `#/learn`, en cada paso de lección (al pulsar Continuar se borra el botón que tenía el foco), en Tonos, en los juegos y tras emparejar en Memory.
- **Por qué importa:** incumple WCAG 2.4.3. Al cambiar de pantalla o de paso, quien usa teclado o lector de pantalla pierde su posición. Ningún test lo detecta.
- **Corrección:** en `router.js`, tras `slot.className = 'route-slot';`, añadir `slot.tabIndex = -1;`. En `src/styles.css:162`, añadir `.route-slot:focus { outline: none; }`.
- **Cómo comprobar:** test en `tests/router.test.mjs`: tras `render`, `slot.getAttribute('tabindex') === '-1'`. Sonda: tras navegar y tras pulsar Continuar, `document.activeElement` está dentro de `#screen` y no es `body`.

### I3. 🔴 Conversación: cambiar de modelo (botón tras un 429 o el select) no cambia el modelo que se envía (C1, paso 3)
- **Dónde:** `src/extras/conversation.js:277-280` (`change` del select) y `:524-529` (`onclick` de `.conv-switch`). `src/chat/providers.js:119-131`: el proveedor captura `model` al crearse.
- **Qué pasa:** los dos manejadores actualizan `cfg`/`storage` y llaman a `paint()`, pero no a `reloadProviders()`. Medido en headless: tras un 429 se pulsa «Probar otro modelo» y se guarda qwen, el select muestra qwen, pero el body de `chat/completions` sigue llevando `model: 'google/gemma-4-31b-it:free'`.
- **Por qué importa:** tras un límite de uso el usuario no puede seguir sin salir y volver a la pantalla. Es justo lo que pedía C1.
- **Corrección:** en los dos manejadores, hacer `await storage.set(...)`, después `await reloadProviders()` y después `paint()`. Es el mismo patrón que `loadModelsOnce` (`:563-566`).
- **Cómo comprobar:** test de pantalla nuevo (`tests/conversation-screen.test.mjs`, ver I10) con un fetch falso: `/models` devuelve 2 modelos gratis y el primer `chat/completions` responde 429. Al pulsar `.conv-switch` y enviar, el `body.model` de la segunda petición es el segundo id.

### I4. 🔴 Si el guardado falla al terminar una lección o Tonos, la pantalla queda bloqueada (I2 de REVIEW-2 a medias)
- **Dónde:** `src/learn/lessons.js:546-557` (`complete()`) y `src/learn/tones.js:218-227` (`onclick` de Finalizar).
- **Qué pasa:** primero deshabilita todos los botones y después hace `await saveProgress(...)` sin `try/catch`. Si el guardado rechaza (cuota llena, IndexedDB cerrado), no se emite `chino:lesson_done`, no se navega, todos los botones (también «Repetir lección») quedan deshabilitados y salta un error no capturado. Reproducido en headless forzando `IDBObjectStore.put` a lanzar. El arreglo de I2 solo cubrió `exerciseStep`.
- **Corrección:** en los dos sitios, `try { await saveProgress(...); } catch (err) { console.warn('lesson: save failed', err); }` y después emitir y navegar igual. En `lessons.js`, `complete()` debe seguir devolviendo para que `reviewMissed` y `finish` continúen.
- **Cómo comprobar:** test DOM con un store cuyo `set` rechaza. Clic en Finalizar → se llama a `ctx.navigate('learn/lessons')` (o a `'learn/tones'`) y no hay rechazo sin capturar. Tres clics → 1 `chino:lesson_done`.

### I5. 🔴 Locale es: el pinyin sin tonos ya no encuentra palabras básicas (regresión de C2)
- **Dónde:** `src/dictionary.js:412-420` (el pinyin solo se consulta si el español da 0 resultados). Causa de fondo: `scripts/build-dict-es-index.mjs` (tokenización, `grep -n esTokens`) mete en el índice las sílabas de las referencias `[wo3]`, `[jia1]` y las de `clasificador:家[jia1]`.
- **Qué pasa:** con datos reales y `spanish=true`: `wo` → 与/word/word姐, **sin 我**. `hao` → 号/友好/好处, **sin 好**. `ren` → 他/法人…, **sin 人**. `chi` pone 来 primero. `jia` da 商店/医院 por su clasificador. El índice tiene, por ejemplo, `"wo":[[92449,3]]`. Con locale en, `wo` sí trae 我. Confirmado también en Chrome con es-ES.
- **Por qué importa:** escribir pinyin sin tonos es la entrada más habitual de un estudiante, y en el idioma principal de la app deja de funcionar.
- **Corrección:**
  1. Al tokenizar en el índice y en el cliente, quitar antes los tramos `/\S*\[[^\]]*\]/g` y las referencias `hanzi|hanzi`. Luego regenerar `public/data/search-es`.
  2. En `search()`, si `await hasExactPinyin(q)`, lanzar `searchPinyin(q)` **a la vez** que `searchSpanish(q)` y mezclar, con los aciertos exactos de pinyin y de español arriba. No usar el pinyin solo cuando el español sale vacío. Mantener la excepción de `ñ`.
- **Cómo comprobar:** en `tests/dict-es-real.test.mjs`, con `public/data` real y `spanish:true`: `wo` incluye 我, `hao` incluye 好 y `ren` incluye 人 en el top 5. Siguen en verde los casos de C2: `árbol`→树, `año`→年 y `pan`→面包 en el top 5.

### I6. Búsqueda ES: como mucho unos 4 resultados, ranking sin relevancia y rutas de reserva pesadas (C3 e I8 a medias)
- **Dónde:** `src/dictionary.js:351` (`ES_MAX_SHARDS = 4`), `:375` y `:394` (`score = 1000 - order + best/100`). `scripts/build-dict-es-index.mjs:89`: rango `nivel*100000 + longitud*1000 + id`.
- **Qué pasa:**
  - Como solo se cargan 4 shards, `agua`, `casa` y `pan` devuelven 4 resultados.
  - El id (hasta 125 427) pesa más que la longitud, así que fuera de HSK el orden es por id: «casa» trae 一木难支 y 世子, y 房子 no entra en las 30 postings. En el cliente, la coincidencia de la definición suma menos de 0,5, así que manda el nivel HSK: `agua`→和 #1 («mezclar… con agua»), `casa`→宾馆 #1, `pan`→菜 #1.
  - El criterio «家 en el top 3 de casa» falla, y el test se rebajó a «hogar» (`tests/dict-es-real.test.mjs:74`).
  - El tokenizador sigue duplicado: `src/dictionary.js:189` frente a `scripts/build-dict-es-index.mjs:138`.
  - Las rutas de reserva siguen pesadas en es: `ni` 35 peticiones/4,2 MB, `dog` 25/3,2 MB y `c` 24/3,35 MB. El caso normal sí cumple: `comer` 9 peticiones/1,41 MB.
- **Corrección:**
  1. En el índice, ordenar por tupla: primero las defs que son exactamente la palabra o empiezan por ella, después la posición del token, nivel HSK, longitud e id. Por ejemplo, rango `nivel*1e9 + posición*1e6 + longitud*1e4 + …`, o un array ordenado sin fórmula.
  2. En el cliente, el score debe ser la relevancia de la def (`best`) con el orden de postings solo como desempate: `score = best * 1000 - order`.
  3. Subir `ES_MAX_SHARDS` a 8, o mejor guardar en las postings una vista previa (simp, pinyin, def ES 0) para no pedir shards al listar.
  4. Que el tokenizador viva en un solo módulo (`src/es-tokens.js`) importado por los dos.
  5. Aplicar a las rutas EN/pinyin el mismo tope de shards que ya tiene `capShards` (`:280`).
- **Cómo comprobar:** con datos reales y `spanish:true`: `agua`[0] es 水; 家 o 房子 en el top 3 de `casa`; `pan`[0] es 面包; al menos 8 resultados para `agua`; ninguna búsqueda (`comer`, `agua`, `ni`, `dog`, `c`) pasa de 12 peticiones ni de 2 MB. Volver a poner `casa` en el test.

### I7. SW: diccionario, búsqueda y trazos en cache-first sin versión: un dato corregido no llega nunca a quien ya lo tenía
- **Dónde:** `sw.js:12` (`DATA_CACHE = 'chino-data-v1'`, fijo) y `sw.js:46-53` (`isImmutableData` devuelve la copia en caché sin ir a la red). Falta además el `event.waitUntil` del `cache.put` del refresco (`sw.js:54-59`).
- **Qué pasa:** las URLs de `/dict/`, `/es/dict/`, `/search-es/` y `/strokes/` no llevan versión y la caché no rota nunca. Esos datos **sí** cambian: `c7b7098` (I6) reescribió 18 shards ES después de `58583bc` (I4), y `search-es` se regenera en cada build. Sonda: con `es/dict/shards/071.json` en caché, se cambia el shard en el servidor, se hace un build nuevo y se recarga. El cliente sigue sirviendo el viejo, incluso con `cache:'no-store'`. Además pueden mezclarse un `search-es` viejo con shards nuevos. Si se regenera CC-CEDICT, se mezclan shards EN y ES desalineados por id, y las traducciones caen en otra palabra.
- **Por qué importa:** ninguna corrección de datos llega a quien ya visitó la app. Solo se arregla borrando los datos del sitio.
- **Corrección:** en `scripts/build.mjs`, calcular `DATA_VERSION` como hash de `data/dict/manifest.json`, `data/es/dict/shards/*` y `data/search-es/*`. Inyectarlo en `sw.js` como `const DATA_CACHE = \`chino-data-${DATA_VERSION}\``. En `activate`, borrar las `chino-data-*` distintas de la actual. Mantener cache-first dentro de una misma versión. Si solo cambia el código, `DATA_VERSION` no cambia y la caché sobrevive (se mantiene I4).
- **Cómo comprobar:** test de build: dos builds con los mismos datos dan el mismo `DATA_CACHE` en `sw.js`, y si se cambia un byte de un shard ES, cambia. Sonda headless: buscar, cambiar un shard, reconstruir y recargar: aparece la def nueva.

### I8. Pipeline ES: los índices commiteados están desfasados, `data:dict-es` regenera un índice muerto y ningún script regenera el que se usa
- **Dónde:** `package.json:14` → `scripts/build-dict-es-index.mjs:199-205` (el CLI solo llama a `buildIndex`, que escribe `index-spanish`). El cliente solo lee `data/search-es` (`src/dictionary.js:39,162`). `public/data/es/dict/index-spanish/` (26 archivos, 1,6 MB, sin uso). `scripts/build.mjs:67`. `public/data/files.json`. Citas viejas en `src/dictionary.js:15`, `CREDITS.md:43` y `docs/i18n-content.md:149-176`.
- **Qué pasa:** `public/data/search-es/e.json` todavía tiene la clave `exprimer` (`grep -c exprimer` da 1), y a `ex` le faltan 14519, 14585 y 32779, aunque los shards ya están corregidos. `npm run dev` sirve ese índice viejo. `tests/dict-es-real.test.mjs` prueba ese índice, no el del build. `npm run data:dict-es` en HEAD da 1 diff, no 0. `files.json` tiene 18 tamaños viejos de shards ES: `npm run data` los cambia.
- **Por qué importa:** el pipeline no reproduce lo commiteado, los tests validan datos distintos de los publicados y hay 1,6 MB de peso muerto en el repo y en el despliegue.
- **Corrección:**
  1. Que el CLI de `build-dict-es-index.mjs` llame a `buildSearchIndex` y escriba `public/data/search-es`.
  2. Borrar `buildIndex`, `public/data/es/dict/index-spanish/` y sus tests (`tests/dict-es-integration.test.mjs:132-158`), y la copia en `build.mjs:67`. Corregir `dictionary.js:15`, `CREDITS.md` y `docs/i18n-content.md`.
  3. Regenerar `search-es` y `files.json` y commitearlos.
- **Cómo comprobar:** en un clon limpio con `.cache`, `npm run data:dict-es && npm run data && git status --short` da vacío (salvo `generatedAt` en `manifest.json`, o mejor quitar esa fecha). `grep -c exprimer public/data/search-es/e.json` da 0. `grep -rn index-spanish src scripts` da vacío.

### I9. Sin conexión tras una visita en frío: Lecturas dice «Próximamente» y Frases queda en blanco con una excepción
- **Dónde:** `scripts/lib/shell-assets.mjs:11` (el precache solo lleva lecciones, `files.json` y `manifest`). `src/screens/read.js:67-70` (cualquier fallo → `common.comingSoon`). `src/learn/sentences.js:47-48` (sin `catch`).
- **Qué pasa:** se abre solo la home y se mata el servidor. `#/read/reading-01` muestra «Próximamente», `#/learn/sentences` queda vacía con `pageerror 'Failed to fetch'`, `#/learn/grammar` dice «0 de 0 patrones» y Temas sale sin lista. Si esas pantallas se visitaron antes, funcionan sin red. Lecciones, Tonos, Repaso y juegos sí funcionan en frío.
- **Por qué importa:** la app se anuncia como offline-first. «Próximamente» es falso y la excepción no se captura.
- **Corrección:**
  1. Ampliar `SHELL_ASSET_RE` con `|^data\/(es\/)?(readings|sentences|themes|grammar|plan)\/|^data\/(achievements|pinyin-chart)\.json$`. Medir antes el peso: unos 1,3 MB más. Si es demasiado, dejar fuera `sentences` y solo arreglar su mensaje.
  2. En `read.js`, distinguir un 404 (`comingSoon`) de un error de red (clave nueva `common.offline`).
  3. En `sentences.js`, `try/catch` alrededor de `loadSentences()` con el mismo mensaje.
- **Cómo comprobar:** el test de `regression-round1` que fija el precache se amplía con `data/readings/index.json`. Sonda: visita en frío solo a la home, servidor muerto: ninguna ruta de contenido muestra «Próximamente», no hay `pageerror` y el precache sigue sin `data/dict`, `data/es/dict`, `search-es` ni `strokes`.

### I10. 🔴 Las correcciones 🔴 siguen protegidas por regex sobre el fuente, y 15 de las 18 de la ronda 1 sobreviven a su reversión (I19 a medias)
- **Dónde:** `tests/review2-critical.test.mjs:151-172` (C1, I2) y `:174-185` (I4, M2). Además `tests/regression-round1.test.mjs`, que solo comprueba que el fuente contiene `isShellAsset`.
- **Qué pasa:** de 61 mutaciones, 39 sobreviven. Las relevantes:
  - **C1:** sobreviven no guardar el modelo, `next = ''` y quitar la guarda del botón duplicado. Solo muere la reversión literal.
  - **I2:** sobreviven `disabled = true; disabled = false;`, quitar `completed = true` en lecciones y Tonos, y quitar el `.catch` de `lessons.js:352`.
  - **I18:** sobrevive quitar `await migrateSecrets(...)` de `main.js:135`.
  - **I5:** sobrevive el `cache.delete` de `esShardDefs` (`dictionary.js:148-152`).
  - **I10 y M3 de REVIEW-2:** JSON crudo, abort que guarda, respuesta vacía aceptada, usuario huérfano y premio sin límite diario. Todo sobrevive, porque `src/extras/conversation.js` (584 líneas) sigue sin test de pantalla.
  - **Ronda 1:** #4 (panel de Pegar), #5 (guardas `alive` en matching/memory/timed), #6b, #7 (el build y `caches.match`), #8b, #9 (temas y gramática), #10, #11 (`review.js:501`, `hardwords.js:188`), #12 (entidades y homógrafos de Anki), #13 (token del router), #14 (`plan.js:55`, `exam.js:86`), #16, #17e (`main.js` `attach`), #18 (memo, abort, signal, refresh), #19 y #25 (`data-url.js:120,143`).
  - **Sync (🟠):** sobreviven `mutate` sin serializar (el test «write during push» de `sync-convergence:360` no lo mata), `cola=[]` en push, sin `schedulePush`, `account.js` con `createSync()` propio y `main.js` sin `online`/`visibilitychange`.
- **Por qué importa:** REVIEW-2 exigía que cada 🔴 dejase un test que falle al revertirse. Un refactor puede devolver el chat que no arranca o los puntos repetidos con todo en verde.
- **Corrección (mínimo imprescindible, 🔴):**
  1. `tests/conversation-screen.test.mjs`: montar la pantalla con el DOM falso de los otros tests de pantalla y usar los hooks `configure`/`resetProviders` (así M22 deja de tener hooks muertos). Fetch falso de `/models` y `chat/completions`. Casos:
     - Solo la clave → existe `.conv-compose` y `settings.openrouterModel` queda guardado.
     - Tras un 429, `.conv-switch` cambia `body.model` (I3).
     - A mitad de stream la burbuja no contiene `{`.
     - Abort → el historial no acaba en `zh:''`.
     - Error → no queda un mensaje de usuario huérfano.
     - 2 conversaciones de 5 mensajes → 1 `lesson_done`.
  2. Test DOM de I2 e I4 sobre la lección y Tonos reales:
     - Dos `click()` síncronos en `.feedback-box .btn.primary` → «Ejercicio 2 de N».
     - Tres clics en Finalizar → 1 `chino:lesson_done`.
     - Store que rechaza → navega igual.
  3. Test de `main.js`/arranque: con `settings.openrouterKey` antes de arrancar, después del arranque está en `meta` y no en `settings`.
  4. Borrar los `assert.match` sobre el fuente de `review2-critical.test.mjs` que queden cubiertos.
- **Corrección (deseable, no bloquea si se documenta):** los «Cómo comprobar» de REVIEW #4, #5, #11, #12, #13 y #25. En el test I7, además leer el `sw.js` generado y exigir `'data/lessons/hsk1/index.json'`.
- **Cómo comprobar:** revertir cada línea de C1, I2, I3, I4 e I18 en una copia → `npm test` falla.

### I11. 🟠 Sync: un dispositivo con el reloj adelantado sigue ganando y el trigger SQL no lo limita al insertar
- **Dónde:** `deploy/supabase-schema.sql:46-61` (`before update` solamente). `tests/sync-convergence.test.mjs:46-53`: el servidor falso pone el tope también en INSERT, al contrario que el SQL. `src/sync/client.js:321-328`: el pull conserva su propio sello futuro. `src/sync/merge.js:84-86`.
- **Qué pasa:**
  - La primera subida de una fila es un INSERT, y el trigger no se dispara: queda `updated_at` a +1 año, y después todo UPDATE de otro dispositivo se descarta.
  - Aunque el servidor recorte el sello, en local A conserva el suyo a +1 año. Al hacer pull gana su copia y no se re-sella (la condición de `:325` exige local < remoto). Al hacer push, su valor viejo se recorta a `now()+5min` y pisa la edición más reciente de B. Sonda: B pone «light» y llega al servidor; tras sincronizar A y B, todos acaban en «dark».
  - El test «clock a year ahead» (`:380`) solo pasa porque el servidor falso no imita al SQL.
- **Corrección:**
  1. SQL: `before insert or update`, con la comparación con `old` solo `if TG_OP = 'UPDATE'`. Que el servidor falso aplique exactamente esas reglas.
  2. Cliente: en push, pedir `Prefer: return=representation,resolution=merge-duplicates` y adoptar en `syncState.updatedAt[key]` el `updated_at` devuelto (ya recortado). Así el sello local no adelanta nunca al del servidor.
- **Cómo comprobar:** test de convergencia con el servidor falso con tope solo en UPDATE+INSERT como el SQL y un reloj de servidor que avanza. A (+1 año) y B (hora real); B edita después; tras `A.sync`, `B.sync` y `A.sync`, A, B y el servidor tienen el valor de B.

### I12. 🟠 Sync: con sync activo, cada escritura local espera a que termine el POST del push
- **Dónde:** `src/sync/client.js:232-262` (la petición de red va dentro de `mutate`, `:247`). `src/storage.js:239-242` (`set` espera a `emit`). Hook en `client.js:405-409`.
- **Qué pasa:** `storage.set` → hook → `enqueue` → `mutate`, que se encola detrás del push, y el push retiene la cadena durante el fetch. Sonda: con un POST pendiente, `store.set('srs', …)` no termina en 300 ms y se resuelve justo al liberar la respuesta. Con red lenta o colgada, calificar una tarjeta o guardar progreso se queda parado.
- **Corrección:** sacar la red de `mutate`:
  1. Primera `mutate`: preparar las filas y anotar los sellos enviados.
  2. Fuera de la cadena: el `fetch`.
  3. Segunda `mutate`: quitar de la cola solo los ids cuyo sello no ha cambiado.

  Alternativa mínima: en el hook, `void enqueue(...)` (sin `await`).
- **Cómo comprobar:** test con un POST que no responde hasta liberarlo: `await store.set('srs','c',…)` termina en < 50 ms. Siguen en verde «escritura durante push» y un test nuevo de «borrado durante push no resucita».

---

## MENORES
Corregir si cuestan 1-5 líneas; anotar el resto.

### M1. Sin CSP (M1 de REVIEW-2, abierto)
- **Dónde:** `index.html:3-19`; `scripts/serve.mjs` no manda la cabecera; `src/chat/webllm-provider.js:34` importa de jsDelivr sin integridad.
- **Corrección:** el `<meta http-equiv="Content-Security-Policy">` propuesto en REVIEW-2 M1. **Comprobar:** recorrer las rutas de `scripts/lib/audit.mjs` escuchando `securitypolicyviolation`: 0.

### M2. LICENSE.md se descarga en vez de mostrarse, cita un LICENSE que no existe y CREDITS no tiene enlace
- **Dónde:** `scripts/serve.mjs:50-61` (no hay tipo para `.md`, así que sale como `application/octet-stream`); `public/data/es/dict/LICENSE.md:21` («repository's LICENSE», y `git ls-files` no tiene LICENSE); Ajustes no enlaza a `CREDITS.md`.
- **Corrección:** `'.md': 'text/plain; charset=utf-8'` en `TYPES`; añadir `LICENSE` (MIT, como dice `package.json`) o quitar la frase; enlace a `CREDITS.md` en Ajustes > Licencias. **Comprobar:** `curl -sI …/data/es/dict/LICENSE.md` da `text/plain`.

### M3. El SW se instala con un precache incompleto y borra el shell anterior
- **Dónde:** `sw.js:26-27` (`allSettled` + `skipWaiting`) y `:35-37`.
- **Corrección:** `cache.addAll` para `src/`, `index.html` y `manifest` (si falla uno, la instalación falla y se reintenta); `allSettled` solo para lo opcional. **Comprobar:** servir un build con un `.js` que devuelve 500: el SW viejo sigue controlando.

### M4. La expansión por prefijo de `searchSpanish` es código muerto que gasta red
- **Dónde:** `src/dictionary.js:363-383`. El filtro exige el token exacto, así que el prefijo nunca acierta: `perr` da 0 resultados con 11 peticiones y 1,45 MB.
- **Corrección:** quitar la expansión, o aceptar en el filtro tokens que empiecen por la consulta cuando la palabra exacta no existe. **Comprobar:** `perr` incluye 狗 con ≤ 10 peticiones, o hace ≤ 2 peticiones.

### M5. Locale es: una búsqueda en inglés da 1-2 resultados absurdos
- **Dónde:** `src/dictionary.js:415-416` (el inglés solo se busca si el español da 0). `hello` → solo 凯蒂猫; `water` → 施耐庵.
- **Corrección:** se resuelve con la mezcla de I5: añadir `searchEnglish` con menos score cuando el español no tiene una def exacta. **Comprobar:** `hello` con `spanish:true` incluye 你好.

### M6. El paso de CI repara antes de validar, y las colas en inglés solo dan aviso
- **Dónde:** `.github/workflows/pages.yml:31-32` → `npm run data:dict-es` (`fix` antes que `validate`). Siguen 24 colas en inglés en producción, solo como aviso: 22124 «variante de 念[nian4], to read aloud», 39807, 30549 «apellido and given name», 49202, 73410… `docs/DICT-ES-QUALITY.md:65` sigue citando `fix-dict-es-quality.mjs`, que no existe.
- **Corrección:** en CI, `npm run data:dict-es && git diff --exit-code`; que la cola en inglés sea error cuando el id no está en `scripts/dict-es-retranslate.json`; retraducir esos 24; corregir el doc. **Comprobar:** meter `exprimer` en un shard → el paso de CI sale con código ≠ 0.

### M7. Se trackean dos scripts de muestreo que fallan en un clon limpio (M20 de REVIEW-2 a medias)
- **Dónde:** `scripts/extract_sample.mjs:6-11` y `scripts/sample_quality.mjs:6-9`, que leen `data-work/` (ignorado). Tienen su propio shuffle y nombres en snake_case.
- **Corrección:** moverlos a `data-work/dict-es/` y actualizar la cita en `DICT-ES-QUALITY.md:114`. **Comprobar:** `git ls-files scripts | grep -c sample` da 0.

### M8. Restos de `lang` y de foco (I13 de REVIEW-2 a medias)
- **Dónde:** hanzi sin `lang` en `src/learn/exercise-view.js:113-116` (feedback con la respuesta), `:167` (prompt mixto «¿Qué significa 谢谢?»), `src/learn/lessons.js:517` (`div.bad` de la respuesta de emparejar) y `sheet-meaning` en la hoja de trazos. En Memory, tras emparejar, las cartas quedan deshabilitadas y el foco cae en `body` (`memory.js:259-261`; se arregla en parte con I2).
- **Corrección:** helper `zhRuns(text)` en `src/hanzi.js` que envuelva cada tramo Han en `<span lang="zh-Hans">` y usarlo en esos puntos; en Memory, enfocar la siguiente carta habilitada. **Comprobar:** sonda de nodos de texto Han sin `closest('[lang^=zh]')` en la lección: 0.

### M9. La hoja de trazos ignora `prefers-reduced-motion` (M15 de REVIEW-2 a medias)
- **Dónde:** `src/learn/strokes-svg.js:151-172` (`createStrokeAnimation` no pasa `reduced`); el que lo usa es `strokes-sheet.js`.
- **Corrección:** pasar `reduced: matchMedia('(prefers-reduced-motion: reduce)').matches`. **Comprobar:** con `reduce`, en `#/learn/strokes/人口` el botón pasa a `done` al instante.

### M10. Queda `listenClass` (resto de I3 de REVIEW-2)
- **Dónde:** `src/learn/exercise-view.js:19,174` y `src/learn/lessons.js:236`.
- **Corrección:** fijar `'btn primary lg'` en el motor y borrar la opción.

### M11. Documentación y comentarios que mienten
- **Dónde:**
  - `README.md:100` (cita `validate-lessons.mjs`, que no existe), `:146-148` («stale-while-revalidate… rotates the caches»), `:169` (HSK2 como trabajo futuro).
  - `src/chat/webllm-provider.js:6` («works offline»).
  - `src/learn/plan.js:19` (`'hsk1' | 'practical'`).
  - `src/dictionary.js:15` (`index-spanish`).
  - `tests/dict-es-integration.test.mjs:1-4` («there is no public/data/es/dict yet»).
  - El comentario de `build.mjs` sobre el precache (~0,5 MB; son 1,3).
  - `VERIFICATION.md`, de 2232 líneas.
- **Corrección:** corregir esas líneas; resumir `VERIFICATION.md` a una página o moverlo a `docs/`. **Comprobar:** `grep -n 'validate-lessons\|rotates the caches' README.md` da vacío.

### M12. Scripts de comprobación: rutas fijas y dependencia no declarada (M21 de REVIEW-2 a medias)
- **Dónde:**
  - Defaults `/tmp` en `scripts/check-exercises.mjs:28`, `check-strokes-dark.mjs:20`, `check-strokes-orient.mjs:29`, `check-tones-headless.mjs:9` y `check-worksheet-pdf.mjs:20`.
  - Ruta absoluta `/home/homelab/.hermes/tools/chromium-1208/…` en `check-exercises.mjs:39` (REVIEW #22).
  - `import('puppeteer')` en `check-tones-headless.mjs:44` y `check-worksheet-pdf.mjs:140`, sin `devDependencies` en `package.json`, aunque `node_modules` lo tiene.
- **Corrección:** default `'dist'`; quitar la ruta absoluta (dejar `CHROME_BIN` y las rutas del sistema); `"devDependencies": { "puppeteer-core": "…" }`.

### M13. Conversación: el saludo inicial y las correcciones siguen en inglés (I11 de REVIEW-2 a medias)
- **Dónde:** `src/chat/prompts.js:34-39` (`OPENERS` con `en` fijo); `:58` (no se pide idioma para `correction`). En locale es, el saludo muestra «Hello! What is your name?».
- **Corrección:** traducción del opener con `t('conversation.opener.<escenario>')`; en el prompt, «write `correction` in {uiLang}».

### M14. Menores de REVIEW-2 que siguen abiertos (detalle y corrección en `docs/REVIEW-2.md`)
- **M4 Anki:**
  - Tres reglas de duplicado: `src/anki.js:189-205`, `src/srs.js:188` y `:227`.
  - En empate de separador gana `;` (`anki.js:107-110`).
  - `accept` sin `.csv` (`src/extras/anki.js:72`).
  - Comentario falso «one duplicate rule» en `anki.js:212`.
- **M5:** `src/screens/dictionary.js:54-56` marca «añadida» por `card.id` e ignora `created:false`; `src/learn/themes.js:110` sigue con `id: \`theme:…\``.
- **M6:** `src/settings.js:96-101` crea un `MediaQueryList` en cada llamada (fuga); el `pinyinToggle` (`settings.js:213-235`) suma un listener por cada `draw()` (`lessons.js:247`).
- **M8:** dos `<main>` en `src/extras/profile.js:29`, `settings.js:47`, `paste.js:239` y `backup.js:147`. Cambiar por `h('section')`.
- **M9:**
  - `.btn-row` y `btn secondary` sin CSS en `src/extras/anki.js:157,159,189,196,197` y `pronounce.js:82,93`.
  - Alias `--fg-soft`/`--radius` (`src/styles.css:56,75`) usados en `conversation.js`, `account.js` y `webllm-provider.js`.
  - Re-estilo de `.conv-chip` (`conversation.js:57-60`).
- **M10:** `src/extras/stats.js:62` (MM/DD fijo), `account.js:49` y `conversation.js:269` sin el locale de la app.
- **M11:** `src/extras/backup.js:57` usa `state.streak` crudo; `src/stats.js:35-43` repite `EVENTS`; `themes.js:152-157` (`markStudied` emite siempre).
- **M12:** `src/hardwords.js:20-28` (`lapses` de por vida); `src/learn/hardwords.js:185` califica tarjetas no vencidas.
- **M13:** Fisher-Yates propio en `games/builder.js:174` y `tones-duel.js:85`; `normalizeWord`/`englishText` duplicados en `exam-gen.js:88,97` y `dictation.js:251,261`.
- **M14:** `src/extras/strokematch.js:227,262`: cargador de trazos propio.
- **M17:** `src/learn/exercise-view.js:74`: `role=progressbar` sin `aria-label` (sonda: «sin nombre» en todos los pasos).
- **M18:** `src/extras/worksheet.js:228` (`showPinyin: true` fijo) y `:505,512,561,571` (`&& pinyinOn`). Con el pinyin global apagado, la casilla sale marcada y no hace nada.
- **M19:**
  - `SAME_NOTE`/`SAME_ES` en `scripts/lib/dict-es.mjs:55,109`.
  - Dos `norm` (`dict-es.mjs:244`, `fix-dict-es.mjs:17`).
  - Dos `loadOriginals` (`fix-dict-es.mjs:58`, `validate-dict-es.mjs:37`).
  - `scripts/translate-dict.mjs:96` trata un shard ilegible como vacío (debe abortar).
- **M21:**
  - Alias muertos en `src/srs.js:263,296-299`.
  - `src/extras/pronounce.js:122,139` sin cleanup y sin CSS para `.pronounce-feedback.correct`/`.try-again`.
  - `src/learn/sentences.js:40`: `cleanupFns` nunca recibe nada.
- **M22 (🟠 la parte del historial):**
  - Hooks `configure`/`resetProviders`/`injected` sin llamadores en `conversation.js:104-111,177-181,556` (los usará el test de I10).
  - Comentarios «another task» en `conversation.js:8,14-15` y `providers.js:14,173`.
  - Alias en `webllm-provider.js:393-394`.
  - El historial vive en `settings` (`conversation.js:101,193`), que se sincroniza: con sync activo se subirían los textos del usuario. Moverlo a `progress` o excluirlo de `SYNC_STORES` antes de activar sync.

---

## Lo que está bien (verificado)

- **Secretos:** una sola lista (`src/secrets.js`) que usan backup (`backup.js:30`), push (`sync/client.js:149`) y pull (`:286`). La migración corre al arrancar (`main.js:135`), antes de `sync.attach`. Probado en el navegador: la clave legacy pasa a `meta` y `exportAll` no la incluye. La clave solo viaja en la cabecera `Authorization`: 0 URLs y 0 `console.*` con ella. `src/sync/config.js` está vacío y no hay ninguna petición a Supabase.
- **Sin XSS:** todos los `html:` pasan por `pinyinHtml`, que escapa en las dos ramas. No hay `eval` ni `new Function`. IA, defs ES, Anki y backup se pintan como texto.
- **Subcarpeta `/chino-app/`:** el SW con scope `/chino-app/`, `start_url`/`scope` `./` y datos por `document.baseURI` resuelven bien (búsqueda ES «perro»: 52 resultados).
- **Precache y carga bajo demanda:** precache pequeño (1,3 MB) y sin el diccionario. La home pide 5-6 JSON (32-35 KB) y nada de `dict`/`strokes`/`search`. Con locale en no se pide nada de `/es/` ni de `/search-es/`.
- **C4 resuelto de verdad:** `npm run data` no borra nada (`scripts/lib/clean-data.mjs` con test real). Frases y HSK regeneran con 0 diff; 0 frases con 要 → yāo (I16).
- **Router (I1):** cada pantalla pinta en su propio nodo, con un test real que muere al revertirlo (falta el foco, I2).
- **Ejercicios:** el doble clic en Continuar va a «Ejercicio 2 de 8» y Finalizar ×3 da 1 `lesson_done` en lección y en Tonos. La persistencia de Tonos es la de lecciones (I3).
- **Anki lineal (I12):** 1000 líneas en 7 ms, 5000 en 32 ms, 10 000 en 76 ms; `idbDriver.list` con `getAllKeys` + `getAll`.
- **Trazos (I14):** partidos en 5 archivos de menos de 600 líneas, con un solo motor (`createStrokeEngine`, 1 `tick`). El botón de la hoja vuelve a «Reproducir». Guía 田 con contraste (`check-strokes-dark` exit 0).
- **Hoja (I15):** fichas y filas con un solo renderizador para vista previa y PDF; pinyin fuera de `showSteps`, con test real.
- **Licencia (I7):** `LICENSE.md` junto a los datos, `CREDITS.md` en el build, enlaces a BY-SA 4.0 y a CC-CEDICT en Ajustes y en la nota del diccionario.
- **Conversación (C1, pasos 1-2, I10, M3):** con solo la clave aparece el chat y se guarda el modelo recomendado. Durante el stream solo se ve el `zh` parcial o «Pensando…». Abortar no guarda nada y un error no deja mensaje huérfano. La recompensa es 1 vez al día.
- **Sync (I17, parte):** `mutate` serializado, cola filtrada por lo enviado, re-sellado en pull, instancia única y `online`/`visibilitychange`. Pull y push filtran secretos.
- **Higiene:** `git status` limpio, 0 coautores, ningún archivo > 1000 líneas y sin `dist/` ni `.cache/` en git.

---

## Estado de los hallazgos de `docs/REVIEW-2.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| C1 | Conversación con solo la clave | **Parcial** | Compose y modelo recomendado guardado (headless). Cambiar de modelo no se aplica (I3). Tests solo regex (I10). |
| C2 | Búsqueda ES con tildes / sílabas pinyin | **Corregido, con regresión** | árbol→树 #1, año→年, pan→面包 top 2, café→咖啡. Rompe el pinyin sin tonos en es (I5). |
| C3 | Una búsqueda ES descarga ~25 MB | **Parcial** | comer/agua/casa: 9 peticiones/1,3-1,4 MB. Solo 4 resultados; rutas de reserva de 24-35 peticiones/3-4 MB (I6). |
| C4 | `npm run data` borra `public/data` | **Corregido de verdad** | 0 borrados en una copia con `.cache`; test de `cleanGenerated` real. |
| I1 | Router: pantalla lenta pinta encima | **Corregido, con regresión** | Slot propio con test real. El slot no admite foco (I2). |
| I2 | Doble clic / Finalizar repetido | **Parcial** | Doble clic y Finalizar ×3 OK. Un guardado fallido al Finalizar bloquea (I4). Test por regex (I10). |
| I3 | Flag `rich` y persistencia duplicada | **Corregido de verdad** | Sin `rich`; Tonos reexporta la persistencia de lecciones; `.is-missed` y `role=status` en Tonos. Resto: `listenClass` (M10). |
| I4 | SW borra la caché de datos | **Parcial** | Nombre fijo; sobrevive al despliegue (sonda). Datos sin versión que no se refrescan nunca (I7) y sin `waitUntil`. |
| I5 | Diccionario sin red | **Corregido de verdad** | `dict.offline` y recuperación en la misma sesión (headless y test real). Hueco: `esShardDefs` sin test (I10). |
| I6 | Errores sistemáticos del dict ES | **Parcial** | 0 `exprimer`/«Taiwán pronunciación»/`variant of`; el validador los detecta. Quedan 24 colas en inglés solo como aviso; el CI repara antes de validar (M6). |
| I7 | Licencia CC BY-SA | **Corregido de verdad** | `LICENSE.md`, `CREDITS.md` en el build y enlaces. MIME y LICENSE inexistente (M2). |
| I8 | Tokenizador duplicado y ranking | **Parcial** | comer→吃 #1, italiano→3544. casa sin 家/房子; tokenizador sigue duplicado (I6). |
| I9 | Tarjetas solo en inglés | **Corregido** | `meaningEs` guardado y mostrado; Pegar pide español. Sin test de pantalla. |
| I10 | Stream con JSON crudo, abort guarda | **Corregido** | Headless: 0 burbujas con `{`; abort no guarda; error quita el mensaje. Sin test (I10 nuevo). |
| I11 | Traducción siempre en inglés | **Parcial** | Prompt con `Spanish` y campo `tr`. Opener y correcciones en inglés (M13). |
| I12 | Anki O(n²) | **Corregido de verdad** | Lineal (10 000 líneas en 76 ms); `getAll` en idb (sin test). |
| I13 | A11y: juegos sin teclado, chino sin `lang` | **Parcial** | Memory con `<button>`, Matching con foco y `aria-pressed`, 5 juegos con 0 Han sin `lang`. Quedan prompt/feedback de lección y foco tras emparejar (M8, I2). |
| I14 | `strokes.js` > 1000 y dos motores | **Corregido de verdad** | 5 archivos de menos de 600 líneas, un motor, botón vuelve a «Reproducir». |
| I15 | Hoja: vista previa ≠ PDF; pinyin de filas | **Corregido de verdad** | `worksheet-cards.js` único; `ws-char-head` = 0; test real del pinyin. |
| I16 | Regenerar frases no da 0 diff | **Corregido de verdad** | 0 diff; data-sanity verde; 0 frases con 要 → yāo. |
| I17 | 🟠 Sync: carreras y convergencia | **Parcial** | Serialización, re-sellado, instancia única y disparadores OK. Reloj adelantado sin resolver y escrituras que esperan a la red (I11, I12). |
| I18 | Clave legacy en backup/pull | **Corregido de verdad** | `SECRET_KEYS` único; migración al arrancar; mutaciones de backup/push/pull mueren. La migración en `main.js` no tiene test (I10). |
| I19 | Huecos de cobertura | **Parcial** | Nuevo `dict-es-real.test.mjs` con datos reales. 39/61 mutaciones sobreviven; 15/18 de la ronda 1 siguen sin test (I10). |
| M1 | Sin CSP | **Abierto** | M1. |
| M2 | `skipWaiting` sin recargar | **Corregido, con regresión** | Recarga al actualizar. Recarga también en la primera visita (I1). |
| M3 | Farmeo de la conversación | **Corregido** | 1 premio al día (headless). Sin test. |
| M4 | Anki: reglas de duplicado y separador | **Abierto** | M14. |
| M5 | Diccionario marca «añadida» por id | **Abierto** | M14. |
| M6 | Fugas de listeners | **Parcial** | Siguen las dos fugas (M14). |
| M7 | Idioma de Perfil no se guarda | **Corregido** | `profile.js:158` guarda (duplica la lógica de `settings.js:208`). |
| M8 | `<main>` anidados | **Abierto** | M14. |
| M9 | CSS-en-JS y clases sin CSS | **Abierto** | M14. |
| M10 | Fechas/números sin el locale | **Abierto** | M14. |
| M11 | Gamificación fuera de su dueño | **Abierto** | M14. |
| M12 | Palabras difíciles | **Abierto** | M14. |
| M13 | Duplicados | **Abierto** | M14. |
| M14 | Cargador propio de `strokematch` | **Abierto** | M14. |
| M15 | Animación sin reduced-motion | **Parcial** | Pantalla de un carácter OK; hoja no (M9). |
| M16 | Contraste de la guía 田 | **Corregido de verdad** | `check-strokes-dark` exit 0. |
| M17 | Progressbar sin nombre, foco | **Abierto (empeorado)** | Sigue sin nombre; el foco ya no va a ningún sitio (I2). |
| M18 | Dos dueños del pinyin de la hoja | **Abierto** | M14. |
| M19 | Pipeline ES y datos | **Parcial** | HSK coincide (0 diff). Helpers duplicados, `translate-dict` traga shards ilegibles e índices commiteados desfasados (I8, M14). |
| M20 | Archivos sin trackear | **Parcial** | `capture_screenshots.py` y `shots/` fuera; los dos scripts de muestreo se commitearon (M7). |
| M21 | Restos de REVIEW.md | **Parcial** | Defaults de contrast/layout y README:55 hechos; el resto en M11, M12 y M14. |
| M22 | Hooks muertos e historial en `settings` | **Abierto** | M14 (🟠 el historial). |

Resumen de la tabla (45): 14 corregidos (10 de verdad y 4 sin test), 3 corregidos con regresión, 15 parciales y 13 abiertos. Ningún crítico de REVIEW-2 sigue abierto como crítico.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** 12 (I1-I12). **Menores:** 14 (M1-M14; M14 agrupa 13 menores de REVIEW-2).
- **Imprescindibles antes de publicar (🔴):** I1, I2, I3, I4, I5 e I10. Todos son baratos: I1, I2 e I4 se arreglan con 1-5 líneas cada uno, e I3 con 2 llamadas.
- **También bloquean el APROBADO según la regla del bucle:** I6, I7, I8 e I9.
- **Imprescindibles antes de activar sync (🟠):** I11, I12 y la parte del historial de M14/M22.
- **Orden recomendado:** I1 → I2 → I4 → I3 → I5 → I8 (regenerar índices) → I6 → I7 → I9 → I10 (tests de lo anterior) → I11/I12 → menores.
- **Los 3 más importantes:**
  1. **I1:** en la primera visita la app se recarga sola y pierde lo que hizo el usuario.
  2. **I5 + I6:** en español, el pinyin sin tonos no encuentra 我/好/人, y la búsqueda española devuelve unos 4 resultados mal ordenados (casa sin 家).
  3. **I3 + I10:** tras un 429, cambiar de modelo no sirve de nada, y las correcciones 🔴 de la conversación y de las lecciones siguen sin un test de comportamiento.
