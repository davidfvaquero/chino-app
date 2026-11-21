# Revisión de calidad thermo-nuclear, ronda 4 (delta): chino-app

- **Base revisada:** `HEAD` = `65e940d`. El delta va desde el informe anterior (`3eb67bd`, REVIEW-3) hasta `HEAD`: 16 commits y 95 archivos (66 de datos).
  - Ojo: `git log -1 -- docs/REVIEW-3.md` devuelve `65e940d` y no `3eb67bd`, porque el corrector añadió una nota a REVIEW-3 (ver M9). El diff correcto es `git diff 3eb67bd..HEAD`.
- **Revisor:** opus (tarea t_dcf5c8e5). Solo lectura. El único archivo nuevo es este informe.
- **Método:**
  - Leí el código de cada hallazgo de REVIEW-3 y el delta completo de `src/`, `sw.js`, `scripts/`, `deploy/` y `tests/`.
  - Sondas con los datos reales de `public/data` usando `search()` de `src/dictionary.js`, con un fetch que cuenta peticiones y bytes. Comparé con la misma sonda sobre `3eb67bd`.
  - Sonda del service worker en Chrome headless sobre un build. Probé el refresco SWR con la red normal y con un proxy que retrasa la respuesta 3 s.
  - 20 pruebas de mutación en una copia (`git archive`): se revierte la línea del arreglo y se pasa `npm test`.
  - `npm run data:dict-es` en una copia.

## Veredicto: **NO APROBADO para publicar**

**Sin críticos.** Quedan **3 importantes** abiertos. De los 12 importantes de REVIEW-3:

- 9 están corregidos de verdad: I1, I2, I3, I4, I7, I8, I9, I11 e I12.
- I5, I6 e I10 están a medias.

Lo que bloquea es casi todo de la búsqueda en español y de tests:

- **I1:** el arreglo de I5 (mezclar pinyin y español) rompe el presupuesto de red de C3. Además no consigue poner 我/好 arriba.
- **I2:** «casa» sigue sin 家 ni 房子 en el top 3.
- **I3:** faltan los tests de comportamiento de la conversación.

Los tres son acotados. I2 es un cambio de datos de una entrada más una regeneración.

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` | 987/987 en verde (3,7 s) |
| `check-es-data` | 114 archivos, 0 errores |
| `validate-dict-es` | 0 errores, 762 avisos |
| `check-i18n` | OK, 957 claves |
| build (`OUT_DIR=… node scripts/build.mjs`) | OK, 2003 archivos, `DATA_CACHE = 'chino-data-b218a4804dcd'` |
| Precache del SW | 327 entradas, 1,69 MB. Sin `dict`, `es/dict`, `search-es`, `strokes` ni `sentences`. Con lecturas (82), temas (27) y gramática (35) |
| `npm run data:dict-es` en una copia | 0 diff con `public/data`. `search-es` del build idéntico al commiteado |
| `grep -rn index-spanish src scripts CREDITS.md docs/i18n-content.md README.md` | vacío. `exprimer` en `search-es/e.json`: 0 |
| `files.json` frente a los tamaños reales | 796 archivos, 1 desfasado (`es/dict/LICENSE.md`, M8) |
| Refresco SWR en Chrome (red normal y retrasada 3 s) | La copia nueva se guarda y llega en la siguiente petición. Sin errores en el SW |
| Mutaciones (20) | Mueren 13 y sobreviven 7. Ver I3 y los menores |
| Checks visuales y mecánicos (tareas madre t_c26860ba y t_6fb3361b) | `check-layout` 156/0, `check-exercises` 8/8, `check-worksheet-pdf` 4/4, `check-strokes-dark` 0 por debajo de 3:1. Sin errores de consola ni scroll horizontal en es/en y claro/oscuro |
| Archivos > 1000 líneas | Ninguno (el mayor es `src/learn/dictation.js`, con 774) |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| `git status --short` | vacío |

## Reglas para quien corrige

- Regla del bucle: el veredicto solo es APROBADO con 0 críticos y 0 importantes abiertos. Los menores no bloquean.
- Las líneas son de `65e940d`. Si se mueven, búscalas con el `grep -n` indicado.
- Puedes tocar datos. Regenerar `public/data` con `npm run data` y `npm run data:dict-es` es seguro: C4 está corregido y `.cache/` existe en `/home/homelab/chino-app`. Commitea los datos regenerados en un commit propio.
- No edites `docs/REVIEW-*.md`. Las notas del corrector van en el comentario de la tarea (M9).
- Cada importante debe dejar **un test de comportamiento**: llamar a la función o montar el DOM falso de `tests/helpers/fake-dom.mjs`. No vale un `assert.match` sobre el fuente. Comprobación: revertir el arreglo hace fallar `npm test`.
- Al final pasa `npm test`, `node scripts/check-es-data.mjs`, `node scripts/validate-dict-es.mjs`, `OUT_DIR=/tmp/chino-fix node scripts/build.mjs` y `node scripts/check-exercises.mjs /tmp/chino-fix`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

### I1. Locale es: el pinyin sin tonos se mezcla sin ranking y rompe el presupuesto de red de C3 (I5 a medias, con regresión)
- **Dónde:**
  - `src/dictionary.js:407-412`: `Promise.all([searchSpanish(q), exactPinyin ? searchPinyin(q) : …])` y después `hits = [...es, ...py]`.
  - `src/dictionary.js:294`: todo acierto exacto de pinyin vale `score: 100`, sin señal de frecuencia.
  - `src/dictionary.js:383`: el español vale `1000 - order`, así que siempre queda por encima del pinyin.
  - `scripts/build-data.mjs:195,214`: `index-pinyin` guarda los shards en orden numérico y no da prioridad a HSK.
- **Qué pasa:** datos reales, `search(q, {spanish:true})`. La columna «antes» es `3eb67bd`:

  | consulta | antes | ahora | top actual |
  |---|---|---|---|
  | `pan` | 9 pet. / 1,23 MB | **26 pet. / 3,08 MB** | 面包 番 泛 潘… |
  | `fan` | 9 / 1,04 | **26 / 2,89** | 磕 哈迷… |
  | `hao` | 9 / 1,01 | **24 / 2,67** | 浩然 郝海东 昊 郝 妇好 号 号 嗥… (好 fuera del top 10) |
  | `mi` | 9 / 1,13 | **24 / 2,77** | 家 我 先 米… |
  | `wo` | 9 / 0,91 | **20 / 2,10** | 沃水 倭 偓 卧 喔 婐 幄 **我 (puesto 8)** |
  | `ren` | 9 / — | **22 / 2,48** | 任安 任 赵元任 仁爱区 工人日报 **人 (puesto 6)** |

  - Ya no aparecen 与/word (el tokenizador nuevo funciona), pero 我/好/人 no llegan al top 5.
  - Toda palabra española que también es sílaba de pinyin (pan, fan, mi, he, te, bao, ma…) pasa de 9 peticiones a 17-26 y supera los 2 MB.
  - En locale en el orden tampoco sirve: `wo` → 我 en el puesto 7 y `hao` → 好 en el 9. El pinyin no tiene ninguna señal de frecuencia.
  - El test `tests/dict-es-real.test.mjs:81-92` solo exige que 我 aparezca en algún puesto («`some`»), no en el top 5 que pedía REVIEW-3. El presupuesto solo se comprueba con `comer` y `agua`.
- **Por qué importa:**
  - Escribir pinyin sin tonos es la entrada más habitual de un estudiante, y 好/我 quedan enterrados bajo nombres propios.
  - La búsqueda de «pan», una palabra básica en español, triplica la descarga. Es la regresión de C3 de REVIEW-2 que se había cerrado.
- **Corrección (mínima, datos + 2 líneas de cliente):**
  1. `scripts/build-data.mjs`:
     - Al escribir los shards, añade `hsk: <1..6>` a cada entrada cuyo par `simp`+pinyin esté en las listas HSK. Ya existe `hskKeys` (`:372-379`, se lee de `.cache/hsk*.txt`). Muévelo antes de construir los shards.
     - Ordena cada lista de `index-pinyin` así: primero los shards que tienen una entrada HSK con esa clave (por el mejor nivel) y después el resto por número.
     - Regenera con `npm run data`.
  2. `src/dictionary.js:294`: `score: 100 + (e.hsk ? 10 - e.hsk : 0)`.
  3. En la rama mezclada de `search()`, puntúa por tramos:
     - español con una definición igual a la consulta (un tramo separado por `;` o `,` cuyos tokens sean exactamente `[q]`): `3000 - order`;
     - pinyin exacto con `e.hsk`: `2000 - e.hsk`;
     - resto del español: `1000 - order`;
     - pinyin sin HSK: `100`.

     En esa rama, que `searchPinyin` pida como mucho 2 shards (parámetro `maxShards`, por defecto `MAX_SHARDS`).
- **Cómo comprobar:** en `tests/dict-es-real.test.mjs`, con `spanish:true`:
  - `wo` tiene 我, `hao` tiene 好 y `ren` tiene 人 en el **top 3** (con `simpTop(r, 3)`). Lo mismo con `spanish:false`.
  - `pan`[0] sigue siendo 面包, `agua`[0] 水 y `comer` tiene 吃 en el top 5.
  - `pan`, `wo`, `hao` y `mi` hacen como mucho 14 peticiones y menos de 2 MB cada una (añadirlas al bucle de `:101`).

### I2. Búsqueda ES: «casa» sigue sin 家 ni 房子 en el top 3 (I6 a medias)
- **Dónde:**
  - `scripts/build-dict-es-index.mjs:57-58`: `level * 1e13 + exact * 1e12 + …`. El nivel HSK pesa más que la coincidencia exacta.
  - `scripts/build-dict-es-index.mjs:114`: `exact = normDef.startsWith(word)`, que también acierta con prefijos («casa» dentro de «casado»).
  - Datos: la entrada principal de 家 (id 32837, `es/dict/shards/035.json`) se traduce como `["hogar","familia",…]`, sin «casa». 房子 (id 44275, def ES `"casa"`) no está en las listas HSK 2.0.
- **Qué pasa:**
  - `casa` → 宾馆 楼 奶奶 屋子 宗祠…, porque cualquier palabra HSK que contenga «casa» en cualquier sitio gana a una definición que es exactamente «casa».
  - 房子 no entra en las 30 postings de `casa`, y 家 no puede entrar porque su definición no tiene la palabra.
  - Lo comprobé en una copia: poner `exact` antes que `level` sube 房子 al puesto 7, pero hunde `café` (咖啡 pasa al 6) y `sol` (desaparece 日). **El orden de la fórmula no es la solución.**
  - Sí funciona sin cambiar la fórmula: `hogar` → 家 #1, porque 家 es HSK1 y su def contiene la palabra.
- **Por qué importa:** «casa» es de las primeras palabras que busca un hispanohablante. 宾馆 (hotel) en el puesto 1 parece un error del diccionario.
- **Corrección (mínima, datos):**
  1. Añade «casa» a la traducción de 家 (id 32837): `"hogar; casa"`. Hazlo por la vía de retraducción que ya usa el pipeline (`scripts/dict-es-retranslate.json` o `fix-dict-es.mjs`), no a mano en el shard, para que `npm run data:dict-es` lo reproduzca.
  2. Corrige el prefijo de `:114`: `const exact = normDef === word || normDef.startsWith(`${word} `) ? 0 : 1;`.
  3. Regenera con `npm run data:dict-es`.

  Con 家 en HSK1 y «casa» en la def, sale primero sin tocar el orden de la fórmula.
- **Cómo comprobar:**
  - Vuelve a poner `casa` en `tests/dict-es-real.test.mjs` (el test se rebajó a `hogar`): 家 en el top 3 de `casa`.
  - Siguen en verde `agua`[0] = 水, `pan`[0] = 面包, `árbol` → 树, `año` → 年 y `café` → 咖啡 en el top 3.
  - `npm run data:dict-es && git status --short` da vacío tras el commit.

### I3. Faltan los tests de comportamiento de la conversación que pedía I10, y dos arreglos nuevos no están protegidos (I10 a medias)
- **Dónde:**
  - `tests/review3-critical.test.mjs:163-271`: ya hay un arnés que monta `src/extras/conversation.js` con fetch falso y prueba el botón tras un 429 (bien).
  - `:232-271`: el test del `select` solo mira `storage` y no el `body.model` enviado.
  - `src/learn/sentences.js:204-210` (catch nuevo de I9): sin test.
  - `tests/review2-critical.test.mjs`: siguen 23 `assert.match` sobre el fuente.
- **Qué pasa (mutaciones que sobreviven con `npm test` en verde):**
  - Quitar `await reloadProviders()` del `change` del select (`conversation.js:281-282`). Es el mismo fallo de I3 de REVIEW-3, por la otra entrada.
  - Quitar el `try/catch` de `loadSentences()` en `sentences.js`. El test de I9 (`regression-round1.test.mjs:54-65`) es un regex que solo busca la cadena `common.offline`.
  - Los casos de REVIEW-2 C1/I10/M3 siguen sin test: JSON crudo en la burbuja durante el stream, abortar que guarda `zh:''`, error que deja un mensaje de usuario huérfano y premio diario repetido. Se verificaron a mano en la ronda 3, pero nada impide que vuelvan.
- **Por qué importa:** REVIEW-3 pedía que cada arreglo 🔴 dejase un test que falle al revertirlo. El arnés ya existe, así que añadir los casos cuesta poco. Sin ellos, un refactor de `conversation.js` (590 líneas) puede devolver el chat roto con todo en verde.
- **Corrección:** en `tests/review3-critical.test.mjs`, reutilizando el arnés de `:163`:
  1. Select: tras `select.dispatch('change')` y dos `tick()`, enviar un mensaje y exigir `bodies.at(-1).model === 'b/free:free'`.
  2. Stream: el fetch falso devuelve dos trozos SSE (`{"zh":"你` y `好"}`). Entre los dos, ningún nodo `.conv-bubble` contiene `{`.
  3. Abort: un stream que no cierra, se pulsa el botón de parar. `storage.get('settings', CONFIG_KEYS.history)` no acaba en un mensaje con `zh: ''`.
  4. Error: `chat/completions` responde 500. El historial no termina con un mensaje de usuario sin respuesta.
  5. Frases: un test DOM de `src/learn/sentences.js` con un fetch que lanza `TypeError`. La pantalla muestra el texto de `common.offline` y `render` no rechaza.
  6. Borra los `assert.match` de `review2-critical.test.mjs:151-172` que queden cubiertos por `review3-critical`.
- **Cómo comprobar:** en una copia, revertir cada una de estas líneas hace fallar `npm test`: `conversation.js:281-282` (reloadProviders del select), el filtro del `{` del stream, la guarda del abort, el borrado del mensaje huérfano y el `try` de `sentences.js:204`.

---

## MENORES
Corregir si cuestan 1-5 líneas. Si no, anotarlos.

### M1. SW: `event.waitUntil` se llama de forma asíncrona, dentro del `.then` del refresco
- **Dónde:** `sw.js:56-63`.
- **Qué pasa:** según la especificación, `waitUntil` lanza `InvalidStateError` si se llama cuando ya no queda ninguna promesa de vida pendiente. En el camino SWR, `respondWith` ya se resolvió con la copia en caché. En Chrome funciona (medido con 3 s de retraso), pero no es portable: en otro navegador el `put` lanzaría, el `.catch(() => null)` lo tragaría y el refresco se perdería sin avisar.
- **Corrección:** crear `network` igual pero con `await cache.put(...)` dentro del `.then`, y en el `fetch` listener llamar a `event.waitUntil(network)` de forma síncrona (`dataStrategy` devuelve `{ response, network }`, o recibe `event` y llama a `event.waitUntil(network)` antes del primer `await`).
- **Comprobar:** el test I7 de `review2-critical.test.mjs` debe exigir que `waitUntil` se llame antes del primer `await` de `dataStrategy`. Mejor aún, un test con un `event` falso cuyo `waitUntil` lance si se llama tarde.

### M2. `DATA_VERSION` no cubre los trazos ni el contenido de los shards EN, y se calcula sobre el fuente y no sobre `dist`
- **Dónde:** `scripts/lib/data-version.mjs:17-21` y `scripts/build.mjs:117`.
- **Qué pasa:**
  - `dict/manifest.json` solo guarda contadores (`entries`, `shards`, `maxShardBytes`), sin fecha. Si se arregla una def EN y el tamaño máximo no cambia, la caché no rota.
  - `strokes/` es cache-first (`sw.js:48`) y no entra en el hash.
  - El README (`:145-149`) dice «a corrected shard reaches everyone».
- **Corrección:** `DATA_SOURCES = [['dict/shards','dir'], ['es/dict/shards','dir'], ['search-es','dir'], ['strokes','dir']]`, calculado sobre `resolve(outDir, 'data')` (lo que de verdad se sirve). Sobre 20 MB tarda menos de 1 s.
- **Test:** hoy sobrevive quitar `['es/dict/shards','dir']` de la lista, porque el test I7 solo cambia `search-es`. Haz que el test cambie un byte de cada fuente por separado.

### M3. El foco tras navegar depende de que cada pantalla llame a `container.focus()`
- **Dónde:** `src/router.js:64-72`.
- **Qué pasa:** `src/learn/strokes-sheet.js` (`#/learn/strokes/戴`) y `src/learn/pinyin-chart.js` no llaman a `focus()`, y el foco cae en `body` (sonda de t_c26860ba). Lo mismo pasa con `themes.js`, `hardwords.js`, `exam.js` y `plan.js` (`grep -Ln '\.focus(' src/learn/*.js`).
- **Corrección:** en el router, tras `await screen.render(slot, …)` (`:75`) y la comprobación del token, añadir `if (!slot.contains(document.activeElement)) slot.focus({ preventScroll: true });`. Así sobran las 29 llamadas sueltas.

### M4. Búsqueda ES: `agua` da solo 4 resultados, y las rutas de reserva siguen pesadas
- **Dónde:** `src/dictionary.js:346` (`ES_MAX_SHARDS = 4`). Las 30 postings de `agua` están repartidas en 18 shards.
- **Medido:** `agua` da 4 resultados (水 和 汤 矿泉水). `dog` hace 17 peticiones/2,07 MB y `c` 16/2,23 MB. Antes eran 25/3,2 y 24/3,35.
- **Corrección:** guardar en las 8 primeras postings una vista previa `[id, shard, simp, pinyin]` y pintar la lista sin pedir shards. O, como mínimo, `ES_MAX_SHARDS = 6` si el presupuesto de I1 lo permite.

### M5. Sync (🟠): reescribir durante el push una clave que ya iba en el lote no tiene test
- **Dónde:** `src/sync/client.js:281-285` (filtro de la cola por sello).
- **Qué pasa:** la mutación `return false` (sacar de la cola todo lo enviado, aunque se haya reescrito) sobrevive. El test I12 (`sync-convergence.test.mjs:429`) escribe una clave **nueva** (`card-1`), no una que ya iba en el lote.
- **Corrección:** en ese test, reescribir también `settings/theme` con el POST retenido y exigir que siga en la cola y que el segundo `syncNow` suba el valor nuevo. Añadir el caso «borrado durante push no resucita».

### M6. Tests: estado global que se filtra
- **Dónde:**
  - `tests/router.test.mjs:54-135`: asigna `globalThis.location` en siete sitios y no lo restaura nunca.
  - `tests/review3-critical.test.mjs:168,236`: deja `meta/openrouterKey` en el `storage` compartido.
- **Corrección:** restaurar `location` en el `finally` (como hace `review2-critical.test.mjs:229-231`) y borrar las claves al terminar.

### M7. Comentarios que apuntan a informes y quedan viejos
- **Dónde:**
  - `src/dictionary.js:341-344`: el comentario de `ES_MAX_SHARDS` remite a la «docs/REVIEW-3.md note» y dice que el ranking «needs the committed indices regenerated».
  - Decenas de `(REVIEW-3 I…)` en el código nuevo.
- **Corrección:** al cerrar I1 e I2, borrar ese comentario. En general, explicar el porqué en el comentario y dejar el número de hallazgo para el mensaje del commit.

### M8. `files.json` desfasado en 1 archivo
- **Dónde:** `public/data/files.json`, entrada `es/dict/LICENSE.md` (el tamaño no coincide con el archivo).
- **Corrección:** `npm run data` y commitear `files.json`.

### M9. El corrector editó el informe del revisor
- **Dónde:** `65e940d` añade a `docs/REVIEW-3.md` la sección «Nota del corrector».
- **Por qué importa:** los informes son el registro del revisor. Al tocarlos, `git log -1 -- docs/REVIEW-3.md` deja de señalar el commit del informe, y la revisión de delta que pide esta tarea calcula una base equivocada (diff vacío).
- **Corrección:** no tocar `docs/REVIEW-*.md`. La nota va en el comentario de la tarea. No hace falta revertir la nota.

### M10. Abiertos o a medias de REVIEW-3 (detalle y corrección en `docs/REVIEW-3.md`)
- **M1, sin CSP:** abierto.
- **M2, licencia:** a medias. Ya existe el tipo `.md` en `serve.mjs`, y `LICENSE.md` ya no cita un LICENSE inexistente. Falta el enlace a `CREDITS.md` en Ajustes > Licencias (`grep -n CREDITS src/extras/settings.js` da vacío).
- **M3, install con precache incompleto:** abierto (`sw.js:28`).
- **M5, inglés en locale es:** abierto (`hello` → solo 凯蒂猫; `water` → 施耐庵). La rama mezclada de I1 es el sitio donde arreglarlo.
- **M6, CI:** abierto. `.github/workflows/pages.yml:33` repara y no hace `git diff --exit-code`.
- **M7, scripts de muestreo:** abierto. `git ls-files scripts | grep -c sample` da 2.
- **M8, `lang` y foco:** abierto (más M3 de este informe).
- **M9, reduced-motion en la hoja:** abierto (`strokes-sheet.js` no pasa `reduced`).
- **M11, documentación:** a medias. README corregido. Siguen `src/chat/webllm-provider.js:6` («works offline») y `VERIFICATION.md` con 2232 líneas.
- **M12, rutas y dependencias de los scripts:** a medias.
  - Los defaults ya son `'dist'`.
  - La ruta absoluta `/home/homelab/.hermes/tools/chromium-1208/…` se quitó y se volvió a poner (`6f1a143`, `check-exercises.mjs:40`).
  - Sigue sin `devDependencies` para puppeteer.
- **M13, opener en inglés:** abierto (`src/chat/prompts.js:34`).
- **M14, menores de REVIEW-2:** abiertos, sin cambios. Lo más relevante antes de activar sync: el historial de la conversación vive en `settings`, que se sincroniza (`conversation.js:193`).
- **Duplicado nuevo pequeño:** el bloque `try { await saveProgress(...) } catch { console.warn('lesson: save failed') }` aparece en `lessons.js:554-563` y en `tones.js:223-232`. Tonos ya reexporta la persistencia de lecciones (`saveProgress`). Si se toca, que `saveProgress` devuelva `false` al fallar en vez de lanzar, y así se borran los dos `try`.

---

## Lo que está bien (verificado en esta ronda)

- **I1, recarga en la primera visita:** `hadController` (`src/pwa.js:43-44`) con test de `navigator` falso que muere al revertirlo. t_c26860ba midió una sola navegación, y `check-exercises` 8/8 y `check-worksheet-pdf` 4/4 ya no fallan.
- **I2, foco:** `slot.tabIndex = -1` y `.route-slot:focus { outline: none }`, con test que muere. Queda el resto de pantallas sin `focus()` (M3).
- **I3, cambio de modelo tras un 429:** `reloadProviders()` antes de `paint()`. El test real comprueba que el `body.model` de la segunda petición cambia, y muere al revertir. `init()` de WebLLM es idempotente, así que reconstruir no descarga nada.
- **I4, guardado que falla:** `try/catch` en `complete()`, en Tonos y en «Repasar lo que fallé». Tonos navega a `learn/lessons` en vez de al mismo hash. Hay cuatro mutaciones y las cuatro mueren.
- **I7, versión de la caché de datos:** `chino-data-<hash>` estampado en el build, test de dos builds y de un byte cambiado, y `activate` borra las cachés distintas. El refresco SWR funciona en Chrome (con los matices de M1 y M2).
- **I8, pipeline ES:** el CLI escribe `search-es`. `buildIndex` y `index-spanish/` se borraron. `npm run data:dict-es` reproduce `public/data` con 0 diff. Tokenizador único en `src/es-tokens.js`, que quita `[pinyin]` y `hanzi|hanzi`.
- **I9, sin red en frío:** precache de lecturas, temas, gramática, plan y logros (1,69 MB, sin datos pesados). `read.js` distingue `TypeError` (sin red) de 404. `sentences.js` muestra `common.offline` (falta el test, ver I3). t_c26860ba lo confirmó sin red en Chrome.
- **I11, reloj adelantado en sync:** trigger `before insert or update` con `tg_op = 'UPDATE'` para comparar con `old`. El cliente adopta el sello recortado solo cuando el servidor lo bajó. El servidor falso imita al SQL, y el test A(+1 año)/B converge en el valor de B. La mutación muere.
- **I12, escrituras que esperan al push:** la red va fuera de `mutate`, en tres fases. Test con POST retenido: la escritura termina en menos de 50 ms (falta el caso de la misma clave, M5).
- **M4 y M10 de REVIEW-3:** corregidos. Expansión por prefijo quitada (`perr` hace 3 peticiones) y `listenClass` borrado.
- **Seguridad:** el delta no toca `src/secrets.js`, ni backup, ni el filtro de secretos de push/pull. `Prefer: return=representation` devuelve filas del propio usuario (RLS sin cambios). No hay `html:` nuevos ni `innerHTML`.
- **Licencia CC BY-SA:** `LICENSE.md` junto a los datos ES, `CREDITS.md` en el build y `.md` servido como `text/plain`.
- **Higiene:** 0 coautores, `git status` limpio, ningún archivo > 1000 líneas y sin `dist/` ni `.cache/` en git.

---

## Estado de los hallazgos de `docs/REVIEW-3.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| I1 | Recarga en la primera visita | **Corregido de verdad** | `hadController`. El test muere al revertir. 1 navegación (t_c26860ba) |
| I2 | Slot sin foco | **Corregido de verdad** | `tabIndex = -1`. El test muere. Quedan pantallas sin `focus()` (M3) |
| I3 | Cambio de modelo no aplicado | **Corregido de verdad** | El body cambia tras un 429 (test que muere). La vía del select funciona, pero su test no mira el body (I3 nuevo) |
| I4 | Guardado fallido bloquea | **Corregido de verdad** | 3 tests DOM y 4 mutaciones que mueren. Tonos ya no se queda muerto |
| I5 | Pinyin sin tonos en es | **Parcial, con regresión** | 与/word fuera. 我 #8, 好 fuera del top 10 y 人 #6. Presupuesto de red de 9 a 20-26 peticiones (I1 nuevo) |
| I6 | Búsqueda ES: ranking, resultados, rutas | **Parcial** | Tokenizador único y prefijo muerto quitados. agua[0] = 水 y pan[0] = 面包. casa sin 家/房子 (I2 nuevo), agua 4 resultados y rutas de reserva de 16-18 peticiones (M4) |
| I7 | Caché de datos sin versión | **Corregido** | Hash de datos en `DATA_CACHE` y test de build. Faltan los trazos y los shards EN en el hash (M2). `waitUntil` tardío (M1) |
| I8 | Índices ES desfasados | **Corregido de verdad** | 0 diff al regenerar, `index-spanish` borrado y `exprimer` 0 |
| I9 | Sin red en frío | **Corregido** | Precache ampliado y mensajes de sin conexión. El catch de frases no tiene test (I3 nuevo) |
| I10 | Tests de comportamiento | **Parcial** | I1-I4, I7 e I11 con tests que mueren. Faltan la conversación (stream, abort, huérfano), el select y frases (I3 nuevo). Siguen 23 regex en `review2-critical` |
| I11 | 🟠 Reloj adelantado | **Corregido de verdad** | SQL en INSERT, adopción del sello y test de convergencia. La mutación muere |
| I12 | 🟠 Escrituras esperan la red | **Corregido** | Red fuera de la cadena y test de menos de 50 ms. Falta el caso de la misma clave (M5) |
| M1 | Sin CSP | **Abierto** | M10 |
| M2 | LICENSE.md y CREDITS | **Parcial** | Tipo `.md` y frase corregida. Falta el enlace a CREDITS en Ajustes |
| M3 | Install incompleto | **Abierto** | M10 |
| M4 | Prefijo muerto | **Corregido de verdad** | `perr` hace 3 peticiones |
| M5 | Inglés en locale es | **Abierto** | `hello` → 凯蒂猫 |
| M6 | CI repara antes de validar | **Abierto** | `pages.yml:33` |
| M7 | Scripts de muestreo | **Abierto** | 2 en git |
| M8 | `lang` y foco | **Abierto** | M10 y M3 |
| M9 | reduced-motion en la hoja | **Abierto** | M10 |
| M10 | `listenClass` | **Corregido de verdad** | Borrado |
| M11 | Docs que mienten | **Parcial** | README OK. Quedan webllm «works offline» y `VERIFICATION.md` |
| M12 | Rutas y dependencias de los scripts | **Parcial** | Defaults `dist`. La ruta absoluta volvió. Sin `devDependencies` |
| M13 | Opener en inglés | **Abierto** | M10 |
| M14 | Menores de REVIEW-2 | **Abierto** | Sin cambios |

Resumen de la tabla (26):

- 12 corregidos: 8 de verdad y 4 con algún resto menor.
- 6 parciales.
- 8 abiertos, todos menores.

Ningún importante de REVIEW-3 sigue abierto sin cambios. Los tres a medias (I5, I6, I10) se convierten en I1, I2 e I3 de este informe.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** 3 (I1-I3). **Menores:** 10 (M1-M10; M10 agrupa los menores que siguen de REVIEW-3).
- **Orden recomendado:**
  1. I2: una traducción, el prefijo y regenerar `search-es`. Es lo más barato.
  2. I1: `hsk` en los shards y en `index-pinyin`, más la puntuación por tramos.
  3. I3: los tests, que deben cubrir también lo de I1 e I2.
  4. Los menores M1, M3, M6 y M8, de 1-3 líneas cada uno.
- **Los 3 más importantes:**
  1. **I1:** en español, «pan», «hao» o «wo» descargan 2-3 MB en 20-26 peticiones, y aun así 好/我 quedan fuera del top 5. Es una regresión de C3 que trajo el arreglo de I5.
  2. **I2:** «casa» devuelve 宾馆 (hotel) primero y ni 家 ni 房子 en el top 3. Se arregla añadiendo «casa» a la traducción de 家 y regenerando.
  3. **I3:** el arnés de la conversación ya existe, pero faltan los casos de stream, abort y error, la vía del select y el catch de Frases. Hoy esas correcciones sobreviven a su reversión.
