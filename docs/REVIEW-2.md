# Revisión final de calidad (thermo-nuclear, ronda 2): chino-app

- Base revisada: commit `d4c6fde` (clon limpio). El working tree del repo tiene sin trackear `scripts/capture_screenshots.py`, `scripts/extract_sample.mjs`, `scripts/sample_quality.mjs` y `shots/` (ver M20).
- Revisor: opus (tarea t_65edf648). Solo lectura: no se ha tocado código, datos, tests ni configuración.
- Primera revisión: `docs/REVIEW.md` (39 hallazgos). Su estado está en la tabla final.

## Estado medido en el clon limpio

| Comprobación | Resultado |
|---|---|
| `npm test` | 938/938 en verde (3,5 s) |
| `node scripts/check-es-data.mjs` | 114 archivos, 0 errores |
| `OUT_DIR=… node scripts/build.mjs` | OK, 1994 archivos, índice ES de 115 shards y 53 508 palabras |
| Precache del SW | 175 entradas, 1,32 MB, **sin** `data/dict` ni `data/es/dict` (correcto) |
| `check-i18n` | OK, 946/946 claves, sin placeholders desbalanceados |
| `check-contrast` / `check-layout` / `check-exercises` | 424/424, 156/156, 8/8 |
| `check-strokes-orient` | 74/74 |
| `check-strokes-dark` | **exit 1**: 4 medidas por debajo de 3:1 (guía `.strokes-guide`, ver M16) |
| `check-worksheet-pdf` | 28 OK. 10 caracteres: 1 página, 347 KB. 20 caracteres: 2 páginas, 671 KB |

Chrome headless usado: `CHROME_BIN=/home/homelab/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`.

## Veredicto: **NO APROBADO para publicar**

Hay 4 críticos. Los tests pasan, pero las pruebas de mutación muestran que la mitad de las correcciones de REVIEW.md no tienen un test que falle si se revierten (ver I19). Los críticos nuevos están en código que ningún test monta: la pantalla de Conversación y la búsqueda en español con datos reales.

## Leyenda y reglas para quien corrige

- 🔴 **Imprescindible antes de publicar.**
- 🟠 **Imprescindible antes de activar sync.** Hoy sync está apagado: `src/sync/config.js` vacío.
- Los números de línea son de `d4c6fde`. Si se desplazan, localízalos con el `grep -n` indicado.
- Cambio mínimo. Tras cada hallazgo, `npm test`. Al final, también `node scripts/check-es-data.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.
- Cada corrección de un 🔴 debe dejar **un test que falle si se revierte**. Es la lección de la ronda 1.

---

## CRÍTICOS

### C1. 🔴 Conversación con OpenRouter: con solo la clave nunca aparece el chat
- **Dónde:**
  - `src/extras/conversation.js:516-520`: `loadModelsOnce()` solo se llama dentro de `if (provider)`.
  - `src/chat/providers.js:123`: `available: () => Boolean(apiKey && model && fetchImpl)`.
  - `src/extras/conversation.js:268`: el select muestra `rec?.id` (el recomendado) pero no lo guarda.
  - `src/extras/conversation.js:498-503`: `switchModel` deja `openrouterModel = ''`.
- **Qué pasa:**
  - Un usuario nuevo pega la clave y `openrouterModel` sigue en `''`, así que el proveedor no está disponible.
  - `paint()` muestra «Configura un proveedor» y no llama a `loadModelsOnce`. El select se queda con 0 opciones y «Cargando modelos…» para siempre.
  - El botón «Cambiar de modelo» que sale tras un 429 lleva al mismo callejón. Además `offerModelSwitch` lo añade otra vez en cada fallo.
- **Por qué importa:** el proveedor principal y gratuito no funciona en el primer uso. Medido con un fetch falso: solo clave → `compose=false`. Con `openrouterModel` guardado a mano → `compose=true`.
- **Corrección:**
  1. En `paint()`, llamar a `loadModelsOnce()` fuera del `if (provider)`. La guarda interna de `:526-527` ya exige openrouter y clave.
  2. En `loadModelsOnce`, al recibir los modelos: si `cfg.openrouterModel` está vacío, guardar `rec.id` con `storage.set('settings', CONFIG_KEYS.openrouterModel, rec.id)` y llamar a `refreshProviders()` y `paint()`.
  3. En `switchModel` (`:498-503`), elegir el siguiente modelo gratis distinto del actual en lugar de `''`. Que `offerModelSwitch` no añada el botón si ya existe.
- **Cómo comprobar:** test nuevo `tests/conversation-screen.test.mjs` (o una sonda headless). Con `storage.set('meta','openrouterKey','sk')` y un fetch falso de `/models`, montar la pantalla: debe existir `.conv-compose` y el select debe tener más de 0 opciones.

### C2. 🔴 Búsqueda en español: las palabras con tilde y las que parecen pinyin no buscan en español
- **Dónde:** `src/dictionary.js:40` (`TONE_MARK_RE` incluye `á é í ó ú`), `:182-188` (`detectType`), `:191-199` (`isPinyin` acepta cualquier prefijo de sílaba), `:348` (pinyin se comprueba antes que español).
- **Qué pasa:**
  - `á é í ó ú` son los mismos caracteres que el 2.º tono. «árbol», «canción», «teléfono» y «café» se clasifican como pinyin y dan 0 resultados.
  - «año» pasa por `tonelessKey` → `ao` y devuelve 傲/凹.
  - «pan», «te», «mi», «de» casan con sílabas o prefijos pinyin: «pan» da 潘 Pān y nunca 面包.
- **Por qué importa:** rompe la función nueva (diccionario en español) en vocabulario básico.
- **Corrección:** con `spanish=true`:
  1. Tratar la consulta como pinyin solo si lleva números de tono, o tonos que no sean `á é í ó ú` (`ā ǎ à ē ě è …`), o si `tonelessKey(q)` existe **exacto** (no prefijo) en el índice pinyin.
  2. En el resto de casos, lanzar `searchSpanish` y `searchPinyin` en paralelo y poner primero los aciertos españoles. No pasar `ñ` por `tonelessKey`.
- **Cómo comprobar:** añadir a `tests/dict-es-integration.test.mjs`, **con los shards e índice reales de `public/data/es/dict`**: `search('árbol',{spanish:true})` incluye 树, `search('año',{spanish:true})` incluye 年 y `search('pan',{spanish:true})` tiene 面包 en el top 5.

### C3. 🔴 Una búsqueda en español descarga casi todo el diccionario (~25 MB)
- **Dónde:**
  - `scripts/build-dict-es-index.mjs:67-77`: el índice guarda palabra → **números de shard**, no ids de entrada.
  - `src/dictionary.js:308-315` (`searchSpanish`): `ids.length < 200 && k.startsWith(primary)` cuenta números de shard con repetidos.
  - `src/dictionary.js:349`: después llama también a `searchEnglish`.
- **Qué pasa:**
  - Los shards se parten por id de entrada, así que una palabra común aparece en casi todos. En el índice, «comer» está en 57 shards, «agua» en 104 y «casa» en 98. Con la expansión por prefijo llegan a 106-115.
  - Medido: la primera búsqueda de «comer» hace 213 peticiones (106 ES + 107 EN), unos 24 MB de JSON. «agua»: 227 archivos, 28,6 MB. En Chrome, el runtime cache pasó a 235 entradas y 28,7 MB tras buscar «agua».
  - Con el debounce del campo, basta teclear la primera letra para lanzarlo.
- **Por qué importa:** en datos móviles la búsqueda española es inusable, y todo queda además en memoria. Con I4 se repite tras cada despliegue.
- **Corrección (mínima):**
  1. En `build-dict-es-index.mjs`, guardar por palabra la lista `[[id, shard], …]` limitada a los N primeros (p. ej. 30) ordenados por `data-work/dict-es/priority.json` o por la puntuación que ya calcula el cliente.
  2. En `searchSpanish`, pedir solo los shards únicos de esos ids, con un tope de unos 8 shards. Usar prefijos solo si la palabra exacta no está.
  - Alternativa mejor: guardar en `index-spanish/<letra>.json` una vista previa por entrada (simp, pinyin, primera def ES), para que buscar sea 1 petición y los shards solo se pidan al abrir una ficha.
- **Cómo comprobar:** test con un fetch contador sobre `public/data` real: `search('comer',{spanish:true})` hace como mucho 10 peticiones y menos de 2 MB, y `吃` sigue en el top 5 (ver I8).

### C4. 🔴 `npm run data` borra todo `public/data`, incluido el diccionario ES, que no se puede regenerar
- **Dónde:** `scripts/build-data.mjs:477`: `fs.rmSync(OUT, { recursive: true, force: true })` con `OUT = public/data` (`:45`). El comentario dice «OUT is fully generated» y es falso.
- **Qué pasa:** al ejecutarlo se borran 443 ficheros que este script no genera: `es/dict` (141 ficheros, 125 427 traducciones hechas con LLM de pago), lessons, readings, themes, grammar, radicals, etymology, el resto de `es/*` y `achievements.json`. Medido en una copia con `.cache`.
- **Por qué importa:** una regeneración rutinaria destruye trabajo hecho a mano y con LLM. Solo se recupera con git, y lo no commiteado se pierde.
- **Corrección:** borrar solo las salidas propias del script: `for (const d of ['dict','strokes','sentences','hsk']) fs.rmSync(path.join(OUT,d),{recursive:true,force:true}); fs.rmSync(path.join(OUT,'manifest.json'),{force:true});`. Revisar en el script qué otros ficheros escribe (p. ej. `es/sentences`) y añadirlos a esa lista. Corregir el comentario.
- **Cómo comprobar:** en una copia con `.cache`, `node scripts/build-data.mjs && git status --short | grep -c '^ D'` debe dar 0.

---

## IMPORTANTES

### I1. 🔴 Router: una pantalla lenta sigue pintando encima de la siguiente (REVIEW #13 a medias)
- **Dónde:** `src/router.js:62-69`. Pintan tras un `await` sin comprobar si siguen vivas, entre otras: `src/learn/lessons.js:181,241`, `src/learn/tones.js:69,79`, `src/learn/exam.js:536-543`, `src/extras/profile.js:16-22`, `src/learn/grammar.js`, `src/learn/games/tones-duel.js:221-238`, `builder.js:224-240`.
- **Qué pasa:** el token `seq` solo descarta el cleanup obsoleto. La pantalla vieja hace `reset(container)` y `draw()` sobre el contenedor compartido después de su `await`. Medido con datos lentos: en `#/extras/settings` el DOM final era la lección (`lesson-tools`, `lesson-intro`), el examen o la gramática.
- **Corrección (una sola, en el router):** renderizar cada pantalla en un nodo propio.
  ```js
  const slot = document.createElement('div');
  slot.className = 'route-slot';
  container.replaceChildren(slot);
  const token = ++seq;
  const result = await screen.render(slot, { route, navigate });
  if (token !== seq) { if (typeof result === 'function') result(); slot.remove(); return route; }
  ```
  Así lo que pinte una pantalla obsoleta cae en un nodo desconectado. Comprobar que el CSS no depende de que las pantallas sean hijas directas de `#screen` (si depende, usar `display: contents` en `.route-slot`).
- **Cómo comprobar:** test en `tests/router.test.mjs`: pantalla A hace `await sleep(50)` y luego `container.append('A')`; se lanza B enseguida. El contenedor acaba solo con B.

### I2. 🔴 Doble clic en Continuar se salta un ejercicio; varios clics en Finalizar dan puntos repetidos
- **Dónde:** `src/learn/exercise-view.js:123` (botón de `finish()` sin guarda); `src/learn/lessons.js:343-355` y `:546-594`; `src/learn/tones.js:190-202` y `:218-235`.
- **Qué pasa:** `onContinue` hace `current += 1` y espera a `saveProgress()` sin deshabilitar nada. Medido: un doble clic pasa de «Ejercicio 1 de 8» a «Ejercicio 3 de 8», y el 2 se puntúa con el resultado del 1. Tres clics en Finalizar de Tonos lanzan 3 `chino:lesson_done` (150 puntos): es el patrón del crítico #3 de la ronda 1. Además `saveProgress().then(draw)` no tiene `.catch`: si el guardado falla, la lección se queda parada.
- **Corrección:**
  - En `finish()`: `onclick: (ev) => { const b = ev.currentTarget; if (b.disabled) return; b.disabled = true; onContinue(result); }`.
  - En los dos `resultStep` (lessons y tones), deshabilitar los botones de acción antes del `await` y emitir `chino:lesson_done` una sola vez por lección (bandera local `completed`).
  - Cambiar `.then(draw)` por `.catch((e) => console.warn(e)).finally(draw)`.
- **Cómo comprobar:** test DOM: dos `click()` síncronos en `.feedback-box .btn.primary` → el título dice «Ejercicio 2 de N». Tres clics en Finalizar → 1 evento `chino:lesson_done`.

### I3. El flag `rich` mantiene la desviación de Tonos (REVIEW #20 a medias), y la persistencia sigue duplicada
- **Dónde:** `src/learn/exercise-view.js:9-24, 84-86, 97-99, 131-145, 178-181`; `src/learn/tones.js:72-74`; duplicados en `tones.js:40-60` frente a `lessons.js:139-159`, `tones.js:78-94` frente a `lessons.js:240-253`, `tones.js:187-206` frente a `lessons.js:340-358`, `tones.js:211-237` frente a `lessons.js:546-558`.
- **Qué pasa:**
  - Con `rich=false` (solo lo usa Tonos), el motor omite `role=status`/`aria-live`, el marcado `is-correct`/`is-missed`/`is-wrong` y la respuesta correcta en el texto de fallo. Es el fallo visible del #20, ahora escondido tras un flag. `tests/tone-lessons-engine.test.mjs:337-358` **fija el comportamiento malo** y hace fallar el arreglo.
  - `progressKey`/`getProgress`/`saveProgress` de Tonos son copias de las de lecciones (`'hsk1:tones'` = `progressKey('hsk1','tones')`). También se repiten el stepper, `onContinue` y el cierre con `chino:lesson_done`. Por eso I2 está en dos sitios.
- **Corrección:**
  1. Borrar `rich` y `listenClass`: usar siempre el cuerpo rico. `readings` y `vocabWords` pasan a ser `Map` vacíos por defecto.
  2. Tonos llama a `getProgress/saveProgress('hsk1', LESSON_ID, …)` de `lessons.js` y borra `tones.js:40-60`.
  3. Actualizar `tone-lessons-engine.test.mjs:337-358` para exigir `is-correct`/`is-missed` y `role=status` en Tonos.
  - Opcional (mayor): mover `orderBody`/`matchBody` (`lessons.js:363-528`) al motor.
- **Cómo comprobar:** `grep -n 'rich' src/learn/exercise-view.js` vacío; `grep -n 'function saveProgress' src/learn/*.js` da 1; en `#/learn/tones`, tras fallar, hay `.is-correct` y `.feedback-box[role=status]`.

### I4. El SW borra el runtime cache de datos en cada despliegue y revalida cada shard en cada sesión
- **Dónde:** `sw.js:11` (`DATA_CACHE = \`chino-data-${VERSION}\``), `sw.js:33-35` (activate borra lo que no está en `keep`), `sw.js:44-53` (stale-while-revalidate: siempre hace fetch).
- **Qué pasa:** cada build cambia `VERSION` y activate borra `chino-data-*`. Medido en Chrome: tras actualizar, el cache de datos bajó de 235 entradas (28,7 MB) a 6. Además cada shard servido desde caché se vuelve a descargar en segundo plano.
- **Por qué importa:** rompe el offline justo después de actualizar y multiplica el consumo de C3.
- **Corrección:** `const DATA_CACHE = 'chino-data-v1';` (nombre fijo). En activate, borrar solo `chino-shell-*` distintos del actual. Para `/data/(es/)?dict/` y `/data/strokes/` usar cache-first sin revalidar (son inmutables entre versiones de datos). Envolver el `cache.put` del refresco en `event.waitUntil`.
- **Cómo comprobar:** sonda headless: buscar, desplegar un `sw.js` con otra `VERSION` y recargar: `chino-data-v1` conserva sus entradas.

### I5. Diccionario sin red: «Sin resultados» y la caché ES queda envenenada toda la sesión (REVIEW #25 reintroducido)
- **Dónde:** `src/dictionary.js:124` y `:134` (`.catch(() => null)` se cachea), `:172, 195, 240, 264` (catch → `null` → `[]`); `src/screens/dictionary.js:240-253` (el estado `error` es inalcanzable). Es un `getJSON` propio que duplica `src/data-url.js:95-106`, que ya distingue `TypeError` (`:120`, `:143`).
- **Qué pasa:** sin red, toda búsqueda da `[]` y la pantalla dice «Sin resultados para «perro»». `esShardDefs` y `loadSpanishIndex` guardan `null` aunque sea un fallo de red: al volver la conexión, la misma sesión sigue sin español hasta recargar.
- **Corrección:** cachear `null` solo si `res.status === 404`. En excepción o 5xx, `cache.delete(url)` / `spanishIndexCache.delete(letter)` y propagar el error. Que `search()` lance si falló un índice, y que la pantalla muestre una clave nueva `dict.offline` («El diccionario necesita conexión la primera vez»).
- **Cómo comprobar:** test con fetch que lanza `TypeError` y luego funciona: primera búsqueda → estado `error`/`offline`; segunda en la misma sesión → resultados.

### I6. Diccionario ES: quedan los errores sistemáticos, el validador no los ve y fix/validate no están en el pipeline
- **Dónde:** `scripts/lib/dict-es.mjs:150-164` (`templateDefToEs`/`isTemplateDef` solo traducen el prefijo), `:118`; `scripts/translate-dict.mjs:430`; `package.json:8-19` (sin script de dict-es); `.github/workflows/pages.yml:31` (solo `npm test`); `scripts/fix-dict-es.mjs` (0 tests); `docs/DICT-ES-QUALITY.md:67,136,174` (cita `scripts/fix-dict-es-quality.mjs`, que no existe).
- **Qué pasa:** en los shards actuales hay 24 definiciones con cola en inglés tras un marcador (p. ej. id 22124 `variante de 念[nian4], to read aloud`, 39807 `…, to engrave`, 30549 `apellido and given name`), 5 `exprimer ministro` (14519, 14585, 32779, 40788…) y 16 `Taiwán pronunciación [x]` (p. ej. 6675). `validate-dict-es` da 0 errores. `fix-dict-es` se ejecutó a mano y nada lo vuelve a pasar.
- **Corrección:**
  1. `isTemplateDef` solo si, tras el marcador, la def es una referencia pura: `/^marker\s*\S+(\[[^\]]+\])?(\s*\([^)]*\))?$/`. Las demás van a una lista de retraducción.
  2. Añadir a `LEAK_FIXES`: `exprimer` → `ex primer` y `Taiwán pronunciación` → `pronunciación en Taiwán`. Añadir al validador las reglas `/\bexprimer\b/` y `/Taiwán pronunciación/` y la de fuga inglesa sobre el resto de la def.
  3. `package.json`: `"data:dict-es": "node scripts/fix-dict-es.mjs && node scripts/validate-dict-es.mjs && node scripts/build-dict-es-index.mjs"`.
  4. Test que ejecute `validateEntry` sobre los shards reales (0 errores) y `repairEntry` sin cambios (idempotencia).
  5. Corregir DICT-ES-QUALITY §4/§7.
- **Cómo comprobar:** `grep -c exprimer public/data/es/dict/shards/*.json | grep -v ':0'` vacío; el test nuevo falla si se mete `variant of` o `exprimer` en un shard.

### I7. 🔴 Licencia CC BY-SA del diccionario ES: falta enlace a la licencia y a la fuente, y nada acompaña a los datos
- **Dónde:** `src/extras/settings.js:180-184` + `src/locales/es.d/settings.json:44` (texto plano, sin enlaces); `public/data/es/dict/` (solo `shards/` e `index-spanish/`, sin licencia, a diferencia de `public/data/dict/manifest.json`); `scripts/build.mjs` (no copia `CREDITS.md`; solo lo hace `scripts/build-pages.sh:17`); `src/screens/dictionary.js:82` (nota «Traducción automática» sin licencia).
- **Por qué importa:** BY-SA 4.0 §3(a) exige atribución, indicar los cambios y un URI de la licencia. Hoy se cumple a medias y solo en GitHub Pages.
- **Corrección:**
  1. Crear `public/data/es/dict/LICENSE.md` con fuente (CC-CEDICT, MDBG), licencia + `https://creativecommons.org/licenses/by-sa/4.0/`, cambios (traducción automática con Claude Haiku y reparación determinista) y ShareAlike.
  2. En Ajustes, convertir el texto en enlaces a la licencia y a CC-CEDICT. En la nota del diccionario, enlazar a esos créditos.
  3. Copiar `CREDITS.md` en `scripts/build.mjs`.
- **Cómo comprobar:** `ls $OUT/CREDITS.md $OUT/data/es/dict/LICENSE.md`; test de Ajustes que encuentre `a[href*='by-sa/4.0']`.

### I8. Búsqueda ES: tokenizador duplicado y ranking sin frecuencia
- **Dónde:** `src/dictionary.js:156-164` (`[a-z][a-z'-]*`) frente a `scripts/build-dict-es-index.mjs:36-42` (`[a-z]+`); ranking en `src/dictionary.js:213-219` y `:326-330`.
- **Qué pasa:**
  - El índice parte «chino-italiano» en dos palabras, pero el cliente compara contra el token entero y descarta la entrada: «italiano» no devuelve el id 3544.
  - Todas las defs de una palabra empatan a 320 y decide el orden del shard: para «comer» salen 哺/啖/茹 y 吃 queda 10.º; 家 no está en el top 20 de «casa».
- **Corrección:** una sola `esTokens` con `/[a-z]+/g` en un módulo compartido (p. ej. `src/es-tokens.js`) que importen script y cliente. Desempatar por prioridad (HSK/frecuencia de `data-work/dict-es/priority.json`), exportada como rango por id en el índice (encaja con C3).
- **Cómo comprobar:** `search('comer',{spanish:true})[0].simp === '吃'`; 家 en el top 3 de «casa»; «italiano» incluye 3544.

### I9. Las tarjetas creadas desde el diccionario o desde Pegar guardan solo inglés
- **Dónde:** `src/screens/dictionary.js:132-140` (`defs: entry.defs`); `src/srs.js:118-127`; `src/screens/review.js:442`; `src/extras/paste.js:328` (lookup sin `{spanish}`) y `:376`.
- **Qué pasa:** con la UI en español, la ficha muestra español, pero la tarjeta guarda el inglés y el repaso lo enseña en inglés. Pegar no pide español nunca (`read.js:81` sí).
- **Corrección:** guardar `defsEs` en la tarjeta (campo `meaningEs`) y que `review.js` lo prefiera con locale `es`. En `paste.js:328`, `lookup(word, { spanish: getLocale() === 'es' })` y pintarlo como en `read.js`.
- **Cómo comprobar:** test: añadir desde el diccionario en `es` → `listCards()[0].meaningEs` existe; el repaso lo muestra.

### I10. Conversación: el streaming enseña JSON crudo, y abortar guarda una respuesta vacía
- **Dónde:** `src/extras/conversation.js:460-474` (`liveSpan.textContent = acc`; nada se comprueba tras el `for await`); `src/chat/prompts.js:57-58` (exige JSON estricto); `src/chat/providers.js:92` (AbortError → return silencioso); `src/chat/webllm-provider.js:272-274,289`; `conversation.js:444` (mensaje de usuario huérfano en error).
- **Qué pasa:** durante la generación se ve `{"zh":"你好！…","pinyin":"nǐ hǎo…`. Si se sale de la pantalla mientras se conecta, `parseReply('')` mete `{zh:''}` en el historial, se persiste y, si era el 5.º mensaje, se da la recompensa. En un error, el mensaje del usuario se queda en `state.messages` y se reenvía.
- **Corrección:** durante el stream, pintar solo el `zh` parcial (`/"zh"\s*:\s*"((?:[^"\\]|\\.)*)/` sobre `acc`) o «Pensando…». Tras el bucle: `if (state.disposed || state.ctrl.signal.aborted) return;`. Si `parsed.zh` está vacío, tratarlo como error. En el `catch`, quitar el último mensaje de usuario.
- **Cómo comprobar:** fake provider lento: a mitad de stream la burbuja no contiene `{`. Fake que cuelga hasta abort: navegar fuera → el historial no termina en `{role:'assistant', zh:''}`.

### I11. Conversación: traducción y correcciones siempre en inglés
- **Dónde:** `src/chat/prompts.js:52-58` (campo `en` y «English translation» fijos); `src/extras/conversation.js:457` (`buildMessages` sin locale), `:376-386`.
- **Corrección:** `buildSystemPrompt({ level, scenario, uiLang: getLocale() })` con «translation in Spanish/English» y clave genérica `tr`; `parseReply` acepta `tr` o `en`. Los OPENERS, con traducción por locale vía `t()`.
- **Cómo comprobar:** test: `buildSystemPrompt({uiLang:'es'})` contiene `Spanish`.

### I12. Importar de Anki es O(n²)
- **Dónde:** `src/srs.js:186` (`listCards()` dentro de cada `addToReview`); `src/anki.js:217-222` (bucle); `src/storage.js:148-153` (`list()` de IndexedDB abre una transacción por clave: REVIEW #36 sin corregir).
- **Qué pasa:** medido con memoryDriver: 1000 líneas 1,0 s, 2000 → 4,0 s, 5000 → 25,9 s. Con IndexedDB real y 2000 tarjetas, cada `addToReview` tarda unos 150 ms.
- **Corrección:** en `idbDriver.list`, una sola transacción con `getAllKeys()` + `getAll()`. En `createDeck`, `addMany(entries)` que construya una vez un `Map` hanzi → tarjetas y lo actualice al insertar; `importCards` lo usa.
- **Cómo comprobar:** sonda de 5000 líneas con memoryDriver en menos de 1 s y crecimiento lineal.

### I13. Accesibilidad: juegos sin teclado y chino sin `lang`
- **Dónde:**
  - `src/learn/games/memory.js:186-192`: cartas `div` con `onclick`, sin rol ni foco; la cara oculta deja el hanzi en el árbol de accesibilidad.
  - `src/learn/games/matching.js:146-148, 242` (y `memory.js:246`): `draw()` hace `reset(container)` + `container.focus()` tras cada clic; el foco salta a `<main>`. Sin `aria-pressed` ni región viva; acierto/fallo solo por color.
  - Hanzi sin `lang`: `src/learn/exercise-view.js:146-165,177`, `lessons.js:375,471`, `tones.js:159`, `matching.js:181`, `memory.js:200`, `timed.js:286`, `builder.js:319,326`, `src/extras/worksheet.js:405-407`.
- **Por qué importa:** WCAG 2.1.1 (Memory no se juega con teclado), 2.4.3 y 1.4.1 (Matching), 3.1.2 (con `html lang=es`, el lector lee 你 con voz española).
- **Corrección:** Memory: `h('button', {type:'button', 'aria-label': …})`, cara oculta con `aria-hidden`. Matching/Memory: tras `draw()`, devolver el foco a `[data-id=…]`; `aria-pressed` en la ficha elegida; `<p role="status">` con Correcto/Incorrecto. Añadir a `src/hanzi.js` un helper `zhText(text, tag='span', attrs)` que ponga `lang='zh-Hans'` y usarlo en esos puntos.
- **Cómo comprobar:** sonda: `.memory-card` enfocable; tras clic en `.matching-chip`, `activeElement` sigue en una ficha; nodos de texto Han sin `closest('[lang^=zh]')` = 0 en lección, Tonos y los 5 juegos.

### I14. `src/learn/strokes.js` pasó de 1000 líneas (1008) con dos motores de animación (REVIEW #29)
- **Dónde:** `src/learn/strokes.js:370-461` (`createStrokeAnimation`) frente a `:626-690` (motor de `createStrokeApp`); `src/learn/strokes-sheet.js:277-292`.
- **Qué pasa:** mismo algoritmo copiado dos veces, con diferencias de medida. `createStrokeAnimation` no avisa al terminar: medido en `#/learn/strokes/人口`, 3,5 s después el botón de la hoja sigue en «Pausar» (`data-state=playing`). El archivo creció de 979 a 1008 sin partirse.
- **Corrección mínima:** `onDone` en `createStrokeAnimation` y usarlo en `strokes-sheet.js` para volver a «Reproducir». **Partición** (mantener re-exports en `strokes.js`):
  - `strokes-geometry.js`: funciones puras (`clamp01`, `medianToPath`, `distanceToPolyline`, `resamplePolyline`, `matchStroke`…), unas 150 líneas.
  - `strokes-data.js`: `VIEW_BOX_SIZE`, `BASELINE_Y`, `OUTLINE_FLIP`, `toStrokeSet`, `createStrokeLoader`, `loadStrokes`…, unas 200.
  - `strokes-svg.js`: `svgEl`, `strokeDiagramSvg` y **un solo** `createStrokeAnimation({ onState })`, unas 150.
  - `strokes.js`: CSS, `createStrokeApp` (usa el motor único) y render.
- **Cómo comprobar:** `grep -c 'function tick' src/learn/strokes*.js` suma 1; `wc -l` < 600 por archivo; el botón de la hoja vuelve a «Reproducir»; `npm test` y `check-strokes-orient` verdes.

### I15. Hoja de caligrafía: la vista previa del estilo fichas no coincide con el PDF; filas pierde el pinyin sin pasos
- **Dónde:**
  - Fichas: `src/extras/worksheet.js:393-475` (vista previa DOM/SVG), `:785-818` (placeholder que duplica la cabecera de `:401-435`), `:129-245` (PDF en canvas). Pinyin: `:424` frente a `:169` y `:800`.
  - Filas: `src/extras/worksheet-rows.js:248-255` (el pinyin solo se pinta dentro de `if (plan.showSteps)`), `:99-101`, `:116`.
- **Qué pasa:**
  - Fichas: la vista previa dibuja contornos SVG, diagrama y número de trazos. El PDF usa `fillText` con una fuente del sistema (riesgo de tofu sin fuente CJK) y no lleva diagrama ni número. Con el pinyin global apagado, la vista previa lo enseña y el PDF no.
  - Filas: con «pasos» apagado no se imprime el pinyin aunque la casilla esté marcada y se reservan 74 pt.
- **Corrección:** fichas al patrón de filas (un `worksheet-cards.js` con `planCards()` y `drawCardsPage(ctx)` sobre `drawGlyph`, que alimente vista previa y PDF) y borrar `renderCharBlock`, el placeholder y `drawCharBlock`/`renderSheetToPages`. Otra opción válida: quitar el estilo fichas. Filas: sacar el `fillText` del pinyin fuera de `if (plan.showSteps)`.
- **Cómo comprobar:** test en `tests/worksheet-rows.test.mjs` con ctx falso y `{showSteps:false}`: `fillText` recibe `'nǐ'`. Con pinyin global apagado, vista previa y `pdfPages()` coinciden. `grep -c 'ws-char-head' src/extras/worksheet.js` = 0.

### I16. Regenerar frases no da 0 diff: el arreglo de #16 empeora el pinyin y falla fuera del BMP; #38 sigue
- **Dónde:** `scripts/build-data.mjs:403-407` (pinyin calculado sobre el zh ya simplificado), `:369-374` (`scoreOf`); `scripts/lib/trad-simp.mjs:23` (`e.simp.length !== 1` cuenta UTF-16).
- **Qué pasa:** regenerado en una copia sin red: 15 pinyin cambian a peor (聽→听 toma 听 yǐn, «听！» → «yǐn»; 甚么 → «shèn yāo»). 3 zh cambian: 𫫇 (2 unidades UTF-16) no entra en el mapa y vuelve 噁, y `tests/data-sanity` falla («sentences are simplified only»). Siguen 28 frases con 要 → yāo en EN y 28 en ES (#38).
- **Corrección:** calcular el pinyin desde el `p.zh` original (antes de `toSimplified`). En `scoreOf`, premiar entradas cuyo simp+pinyin estén en las listas HSK (resuelve #38 y 听). En `trad-simp.mjs`, `[...e.trad].length === 1 && [...e.simp].length === 1`. Regenerar y commitear.
- **Cómo comprobar:** regenerar en una copia: 0 diff en `public/data/{,es/}sentences`; `data-sanity` verde; 0 frases con 要 leído yāo.

### I17. 🟠 Sync: carreras en `syncState` y reglas de conflicto que no convergen
- **Dónde:** `src/sync/client.js:198-230` (`push`: `loadState` → red → `saveState` de la copia vieja), `:248,290` (`pull`), `:306-330` (`enqueue`/`enqueueDelete`); `src/extras/account.js:54` (segunda instancia `createSync()`); `src/sync/merge.js:62-66` (srs: «más reviews gana») frente a `deploy/supabase-schema.sql:46-48` (trigger: «updated_at mayor gana»); `client.js:124,281,311,326` (`updated_at` = reloj del cliente); `src/main.js:133-137` (sync solo en el arranque).
- **Qué pasa (reproducido con el servidor falso, trigger incluido):**
  - Escribir o borrar durante el POST de `push`: push guarda su copia vieja y pierde la marca o la lápida. El siguiente pull revierte la edición o resucita lo borrado. Dos `set` concurrentes: sobrevive 1 de 3 marcas.
  - `account.js` crea su propia instancia: su bandera `applying` no la ve el hook global, que vuelve a encolar lo recibido.
  - srs: B (6 reviews, t=900) y A (5 reviews, t=1000). El pull de B conserva su copia pero con t=900; el trigger descarta el push (201 igualmente). Estable: A=5, servidor=5, B=6.
  - Un dispositivo con el reloj adelantado bloquea esas filas mientras dure el desfase.
  - Nada sube hasta el siguiente arranque en frío.
- **Corrección:**
  1. Serializar toda mutación de `syncState` en `createSync`: `let chain = Promise.resolve(); const mutate = (fn) => (chain = chain.then(async () => { const s = await loadState(); await fn(s); await saveState(s); }));`. En `push`, tras la red, recargar el estado y quitar de la cola solo lo enviado.
  2. `account.js` importa la instancia `sync` global.
  3. En pull, si gana la copia local con un ts menor que el remoto, remarcarla con `Math.max(now(), remoteTs + 1)`.
  4. En el trigger: `new.updated_at := least(new.updated_at, now() + interval '5 minutes');` (y lo mismo en el servidor falso).
  5. Push con debounce (~5 s) tras `enqueue`, más `syncNow` en `online` y en `visibilitychange` (oculto).
- **Cómo comprobar:** casos nuevos en `tests/sync-convergence.test.mjs`: escritura durante push conserva la marca; borrado durante push no resucita; srs 6/6/6; reloj +1 año no bloquea.

### I18. 🔴 La clave legacy `settings.openrouterKey` todavía sale en el backup y el pull la reescribe
- **Dónde:** `src/backup.js:29-30` (`PRIVATE` solo cubre `meta`); `src/extras/conversation.js:123-129` (la migración solo corre al abrir Conversación); `src/sync/client.js:251-252` (pull no filtra `settings/openrouterKey`).
- **Qué pasa:** un dispositivo que no ha abierto Conversación desde la actualización conserva la clave en `settings`, y `exportAll` la incluye. Si un cliente viejo ya la subió, cada pull la vuelve a escribir en `settings` (en local «no existe» y gana la remota).
- **Corrección:** `PRIVATE = { meta: …, settings: new Set(['openrouterKey']) }`. Mover la migración a un paso de arranque en `main.js`, antes de `sync.attach()`. En pull, ignorar filas `settings/openrouterKey` (mejor: una lista `SECRET_KEYS` compartida por `backup.js` y sync).
- **Cómo comprobar:** test en `tests/backup.test.mjs`: con `set('settings','openrouterKey','sk')`, `JSON.stringify(await exportAll(db))` no contiene `sk`. Test en sync: un pull con esa fila no la escribe.

### I19. Huecos de cobertura: muchas correcciones de la ronda 1 sobreviven a su reversión
- **Dónde:** `tests/`. Pruebas de mutación hechas en una copia (revertir la línea clave y ejecutar el test concreto).
- **Sobreviven (ningún test falla):** #1 (guardar la clave en `settings`, no migrar), #4 (panel de Pegar), #5 (las 3 guardas `alive`), #6b (nombres de tono), #7 (regex de precache, `caches.match`), #8b (racha), #9 (los 3 farmeos), #10 (intervalo de Timed), #11 (avanzar tras fallo de guardado), #12 (entidades, homógrafos), #13 (router), #14 (niveles hsk2/3), #15 (CSS de trazos), #16 (pipeline sin `toSimplified`), #17e (`main.js` sin `attach`), #18 (memo, abort, `reader.cancel`, refresh), #19 (`typing` con sort sesgado), #25 (negativos de red).
- **Mueren (bien cubiertos):** #1 (backup y sync), #2, #3, #8a, #17 a-d, #20.
- **Otros huecos:** `src/extras/conversation.js` (548 líneas) no tiene ningún test de pantalla; `tests/tones.test.mjs` inyecta `fetchJson` en vez de usar `fetchData`; `tests/dict-es-integration.test.mjs:1-4` usa datos ES sintéticos (comentario obsoleto: «there is no public/data/es/dict yet») y su test de pantalla es un regex sobre el fuente; `tests/design-ronda2b.test.mjs` y `design-ronda2c.test.mjs` son sobre todo `assert.match` de literales del código.
- **Corrección:** añadir, como mínimo, los tests de «Cómo comprobar» de REVIEW #4, #5, #7 (ejecutar `build.mjs` a un dir temporal y buscar `data/lessons` en `sw.js`), #9, #11, #12, #13 y #18, y los de C1, C2, C3 e I5 con datos reales. Sustituir los regex de diseño por montajes reales o borrarlos si `check-contrast`/`check-layout` ya lo cubren.
- **Cómo comprobar:** repetir cada mutación: el test correspondiente falla.

---

## MENORES
Corregir si cuestan 1-5 líneas; el resto, anotar.

- **M1. Sin CSP.** `index.html:3-17`; ningún despliegue pone cabecera. `src/chat/webllm-provider.js:34,109` importa de jsDelivr sin integridad, en el mismo origen que la clave y los tokens. Hoy no hay XSS (verificado), así que es defensa en profundidad. **Corrección:** `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' https://openrouter.ai https://*.supabase.co https://cdn.jsdelivr.net https://huggingface.co https://*.hf.co https://raw.githubusercontent.com http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'">`. **Comprobar:** recorrer las rutas de `scripts/lib/audit.mjs` escuchando `securitypolicyviolation`: 0.
- **M2. `skipWaiting` + `clients.claim` sin recargar.** `sw.js:26,37`; `src/pwa.js:34-39`. Una sesión abierta mezcla módulos de dos versiones en los `import()` perezosos. **Corrección:** en `pwa.js`, `navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })`.
- **M3. Farmeo de la recompensa de conversación.** `src/extras/conversation.js:471-474`, `:326`, `:357`: 5 mensajes + «Nueva conversación» = +50 sin límite. **Corrección:** guardar `conversationRewardDay = localDayKey()` y premiar como mucho una vez al día.
- **M4. Anki: dos reglas de duplicado y separador mal detectado.** `src/anki.js:188-205` (`planImport`) frente a `src/srs.js:183-189`: con 你 nǐ en el mazo, `你\t\tyou` da vista previa `{new:1}` e import `{added:0}`; 好 hǎo/hào → 1 añadida. `src/anki.js:107-110`: en empate gana `;` sobre `,`. `src/extras/anki.js:72`: `accept` sin `.csv`. **Corrección:** un único `findDuplicate(cards, entry)` exportado de `srs.js` (tonos con `prettyPinyin` si ambos los traen; `tonelessKey` solo si faltan); desempate tab > `,` > `;` > `|`; `accept` con `.csv,text/csv`. Corregir el comentario «one duplicate rule» (`anki.js:212`).
- **M5. Diccionario marca «añadida» por id (REVIEW #2 a medias).** `src/screens/dictionary.js:53-61,266` y `:132-144` (ignora `created:false`); `src/learn/themes.js:110` sigue pasando `id: \`theme:…\``. **Corrección:** `deckIds()` por clave hanzi + `tonelessKey(pinyin)` con el mismo `findDuplicate`; usar `created` para el aviso; quitar el `id` de `themes.js:110`.
- **M6. Fugas de listeners.** `src/settings.js:96-111`: cada `syncAutoListener` crea un `MediaQueryList` nuevo y quita el listener de ese (REVIEW #36). `src/settings.js:219-237` + `src/learn/lessons.js:247`: `pinyinToggle` deja un listener en `window` por cada `draw()`. **Corrección:** guardar `mql` a nivel de módulo; crear el toggle una vez en `renderLesson` o que devuelva `{el, dispose}`.
- **M7. El idioma elegido en Perfil no se guarda.** `src/extras/profile.js:157` solo hace `setLocale`; `src/extras/settings.js:196-202` además guarda. **Corrección:** `changeLocale(code)` en `settings.js` (set + guardar) usado por los dos, o quitar el selector de Perfil.
- **M8. `<main>` y `app-header` anidados.** `src/extras/profile.js:25-28`, `settings.js:44-47`, `paste.js:238-239`, `backup.js:149`. **Corrección:** `h('section')` y `h('h2')` dentro del container. **Comprobar:** `document.querySelectorAll('main').length === 1`.
- **M9. CSS-en-JS (REVIEW #28).** 29 `function ensureStyles` + 1 `injectCss`. Re-estilos de botón/chip contra `docs/DESIGN.md` §6.1: `conversation.js:55-57` (`.conv-chip`), `paste.js:35-41` (`.paste-btn`), `draw.js:34-39`, `worksheet.js:299,312`, `learn/hardwords.js:18`, `games/matching.js:35`, `games/timed.js:40`, `radicals.js:65,77`. Tokens legacy `--fg-soft`/`--radius` en `conversation.js`, `account.js`, `webllm-provider.js`. Clases sin CSS: `.btn-row` y `.btn.secondary` en `src/extras/anki.js:157,159,189,196,197` y `pronounce.js:82,93`. **Corrección mínima:** `.btn-row` → `cluster`, quitar `secondary`, `--fg-soft` → `--ink-soft`, `--radius` → `--r-md`. La migración a `injectCss` puede esperar.
- **M10. Fechas y números sin el locale de la app.** `src/extras/stats.js:62` (MM/DD fijo), `src/extras/account.js:49` (`toLocaleString()` sin locale), `src/extras/conversation.js:266` (`toFixed(3)`). **Corrección:** `Intl.DateTimeFormat(getLocale(), {day:'numeric', month:'numeric'})` e `Intl.NumberFormat(getLocale(), {maximumFractionDigits:3})`.
- **M11. Reglas de gamificación fuera de su dueño.** `src/extras/backup.js:57` lee `state.streak` crudo (racha caducada en el resumen del backup); `src/stats.js:35-43` repite las claves de `EVENTS`; `src/learn/themes.js:144-158` (`markStudied` emite siempre; la guarda está solo en el botón). **Corrección:** exportar `streakAt(state, at)` de `gamification.js` y usarlo en backup; `markStudied` emite solo si es nuevo.
- **M12. Palabras difíciles: la lista nunca se vacía y la práctica reprograma.** `src/hardwords.js:20-28` (`lapses` de por vida); `src/learn/hardwords.js:185` (califica tarjetas no vencidas). **Corrección:** difícil solo si `lapses >= min && (lastRating === 'again' || reps < 3)`; no llamar a `answer` si `card.due > now`.
- **M13. Duplicados que el #19 no detectó.** Fisher-Yates propio en `src/learn/games/builder.js:174-181` y `tones-duel.js:85-92`; carga HSK1 a mano en `builder.js:186-187` y `tones-duel.js:175-176`; `normalizeWord`/`englishText` en `exam-gen.js:88,97` y `dictation.js:251,261` (ya divergen: `entry.id ||` frente a `??`); `builder.js:393` `return () => {}`. **Corrección:** `import { shuffle } from '../../random.js'`; `loadLessonVocabulary()` en `games/common.js`; un solo módulo para `normalizeWord`/`englishText`.
- **M14. `strokematch.js` con cargador propio (REVIEW #30).** `src/extras/strokematch.js:196-276` (fetch propio, ruta fija `strokes/index.json`, `padStart(3)`, su propio giro de y en `:207`). **Corrección:** usar `createStrokeLoader` y las medianas ya giradas de `toStrokeSet()`.
- **M15. La animación de trazos ignora `prefers-reduced-motion`.** `src/learn/strokes.js:964` (show → start). **Corrección:** con `matchMedia('(prefers-reduced-motion: reduce)').matches`, pintar todo a 1 y `setPlayState('done')`.
- **M16. Contraste de la guía 田 a 1,91-2,45:1.** `src/learn/strokes.js:308` (`.strokes-guide { stroke: var(--grid) }`, cambio de `eb43bde`). `check-strokes-dark` sale con 1. **Corrección:** volver a `stroke: var(--edge)` con `stroke-dasharray: 5 4`. **Comprobar:** `check-strokes-dark` exit 0.
- **M17. Progreso sin nombre y foco en `<main>`.** `src/learn/exercise-view.js:73-80` (`role=progressbar` sin `aria-label`); `lessons.js:248`, `tones.js:88` (`container.focus()`). **Corrección:** `aria-label: t('learn.lessons.progress')`; enfocar el `h2` del paso con `tabindex=-1`.
- **M18. Dos dueños del pinyin impreso en la hoja.** `src/extras/worksheet.js:572-573, 734-740, 765, 847, 875-881`: el PDF usa `options.showPinyin && pinyinOn`, así que la casilla puede estar marcada sin efecto. **Corrección:** inicializar la casilla con el ajuste global y que después mande solo la casilla.
- **M19. Pipeline ES y datos.** Helpers duplicados: `scripts/lib/dict-es.mjs:55` y `:104` (`SAME_NOTE` = `SAME_ES`), `norm` en `lib/dict-es.mjs:236` y `fix-dict-es.mjs:17`, 3 `loadOriginals` (`validate-dict-es.mjs:37`, `fix-dict-es.mjs:58`, `translate-dict.mjs:82`). `scripts/translate-dict.mjs:95-96`: un shard ilegible se trata como vacío y se sobrescribe (debe abortar). `public/data/es/dict/index-spanish/` está commiteado y además se regenera en el build (hoy coinciden; añadir test de igualdad o `.gitignore`). `public/data/hsk/4.json`, `6.json` y `manifest.json` no coinciden con lo que genera `build-data.mjs` (hsk4 598 frente a 600; hsk6 2499 frente a 2500; manifest dice hsk3=300 y hay 297).
- **M20. Ficheros sin trackear en el repo.** `scripts/capture_screenshots.py` (rutas absolutas en `:13` y `:62`), `scripts/extract_sample.mjs`, `scripts/sample_quality.mjs`, `shots/`. **Corrección:** moverlos a `data-work/dict-es/` (ya ignorado) o borrarlos, y añadir `shots/` a `.gitignore`. **Comprobar:** `git status --short` vacío.
- **M21. Restos de REVIEW.md.** #33: `scripts/check-tones-headless.mjs:44` sigue con `import('puppeteer')` (no declarado). #32: defaults `/tmp` en `check-contrast.mjs:26` y `check-layout.mjs:27` (cambiar a `dist`). #34: alias `gradeCard`/`dueCards`/`schedule` en `src/srs.js:212,245,246,248`. #37: `src/extras/pronounce.js` sin cleanup (`:122`, `:139`) y sin CSS para `.pronounce-feedback.correct`/`.try-again` (acierto y fallo se ven igual); `src/learn/sentences.js:40,183,241` (`cleanupFns` vacío). #39: `README.md:55` («Lessons (`hsk1`)»), `VERIFICATION.md` (2232 líneas), `src/chat/webllm-provider.js:6` («works offline»). Comentario obsoleto en `src/learn/plan.js:19`.
- **M22. Conversación: hooks de test muertos y almacenamiento mal ubicado.** `src/extras/conversation.js:101-108, 174-178, 528` (`configure`/`resetProviders`/`injected` sin ningún llamador); comentarios de `:8,14-15` y `src/chat/providers.js:14-15,172-174` («shipped by another task»); `webllm-provider.js:392-394` (3 alias del mismo factory); historial en el store `settings` (`:190`), que se sincroniza. **Corrección:** usarlos desde el test de C1 o borrarlos; mover `conversationHistory` a `progress`.

---

## Lo que está bien (verificado)

- Sin XSS: `h()` usa `textContent`; `pinyinHtml` escapa (fuzz con `<img onerror>`, `<script>`). Respuestas de IA, defs ES, Anki y backup se pintan como texto.
- `meta.openrouterKey`, `syncSession` y `syncState` no salen en el export ni en el push; el import `replace` las conserva y valida antes de escribir.
- Tokens solo en la cabecera `Authorization`; nada en URLs ni en `console.*`. RLS correcto en el esquema.
- Subcarpeta `/chino-app/`: scope del SW, `start_url`, scope e iconos resuelven; 0 respuestas 4xx en headless.
- Precache sin el diccionario; lecciones y Tonos funcionan en frío sin red.
- Pinyin global: un único mecanismo (`.py` + `html[data-pinyin=off]` + `.py-keep`); `pinyinToggle` con `aria-pressed`.
- `pdf.js` mínimo y correcto (xref de 20 bytes, JPEG DCTDecode, A4). El estilo filas tiene un único renderizador para vista previa y PDF.
- Trazos al derecho: `check-strokes-orient` 74/74.
- `day.js`, `random.js` y `games/common.js` únicos para lo que cubren; gamificación serializada y racha caducada en `snapshot`.
- `translate-dict` con escritura atómica, reanudable y volcado por señal (con test). `fix-dict-es` determinista e idempotente. Shards ES con la misma numeración que los EN (125 427 ids). Con locale `en` no se pide nada de `/data/es/`.
- `#16` (trad→simp) automatizado y `#31` (gemelo de pinyin) resuelto, salvo lo de I16.
- `check-i18n` OK y `html lang` sigue al locale.

---

## Estado de los hallazgos de `docs/REVIEW.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| 1 | Clave y sesión en backup/sync | **Parcial** | `meta` + `PRIVATE` OK y con test. Falta la clave legacy en `settings` (I18) y test de la migración (I19). |
| 2 | Misma palabra varias veces en el mazo | **Parcial** | `addToReview` deduplica (con test). Diccionario marca por id y `themes.js:110` sigue con `id: theme:` (M5). |
| 3 | Timed: inundación de `lesson_done` | **Corregido** | Solo en `finishGame`; test con timers falsos mata la mutación. |
| 4 | Paste: panel invisible | **Corregido** | Sin test (I19). |
| 5 | Juegos repintan tras salir | **Corregido** | Guardas `alive` + cleanup. Sin test (I19). |
| 6 | Tonos en inglés para `es` | **Corregido** | `fetchData` + `toneName`. Nombre de tono sin test. |
| 7 | Offline sin precache de lecciones | **Corregido** | 40+40 lecciones en `sw.js`. Sin test. Nuevo problema de cache de datos en I4. |
| 8 | Gamificación: carrera y racha | **Corregido** | (a) con test; (b) sin test. Backup lee la racha cruda (M11). |
| 9 | Farmeo de puntos | **Parcial** | Los 3 arreglos están, sin tests. Conversación farmeable con «Nueva conversación» (M3); nuevo farmeo con Finalizar (I2). |
| 10 | Timed repinta cada 100 ms | **Corregido** | Sin test. |
| 11 | Repaso: audio y calificar | **Corregido** | `answerAndNotify`. El `catch` sin test. |
| 12 | Anki: entidades y homógrafos | **Corregido** | Verificado por sonda; sin tests. Quedan reglas dobles (M4) y O(n²) (I12). |
| 13 | Router: pantalla lenta pinta encima | **Parcial** | El token solo descarta el cleanup; el DOM se sigue pisando (I1). Sin test. |
| 14 | Niveles HSK2/HSK3 | **Corregido** | Sin test. |
| 15 | Worksheet oscuro y cuadrícula | **Corregido** | Ruta añadida a `check-strokes-dark`; ese check falla por la guía de trazos (M16). |
| 16 | Trad→simp en el pipeline | **Parcial** | Automatizado, pero regenerar no da 0 diff y rompe un test (I16). |
| 17 | Sync entre dispositivos (a-e) | **Parcial** 🟠 | a-e hechos y con tests (salvo `main.js` attach). Carreras de `syncState`, divergencia srs/trigger, reloj y sync solo al arrancar (I17). |
| 18 | Conversación: proveedores, abort, GPU | **Corregido** | Sin tests. Problemas nuevos en C1, I10, I11. |
| 19 | Helpers duplicados | **Parcial** | `random.js` y `common.js` OK; quedan shuffle en builder/tones-duel y `normalizeWord`/`englishText` (M13). |
| 20 | Tonos copia el motor | **Parcial** | Motor compartido, pero el flag `rich` conserva el fallo visible y la persistencia sigue duplicada (I3). |
| 21 | Tests por lotes | **Corregido** | `content-data.test.mjs` con 80 subtests; borrados los sueltos. |
| 22 | Rutas absolutas en scripts | **Corregido** | Quedan rutas en `scripts/capture_screenshots.py` sin trackear (M20). |
| 23 | SW en dev | **Corregido** | `if (DEV) return`. |
| 24 | Check tautológico en el build | **Corregido** | Borrado. |
| 25 | Negativos de red en `data-url` | **Corregido** | Sin test; el mismo fallo reaparece en `dictionary.js` (I5). |
| 26 | Día local ×6 | **Corregido** | `src/day.js` único. |
| 27 | Eventos en 3 tablas | **Corregido** | `gamification-wire` deriva de `EVENTS`; `stats.js` aún repite claves (M11). |
| 28 | CSS-en-JS | **Abierto (justificado)** | 30 copias; justificación aceptable. Re-estilos de `.btn`/`.chip` baratos de quitar (M9). |
| 29 | Dos motores de animación | **Abierto** | Justificación débil: fallo visible y archivo ya > 1000 líneas (I14). |
| 30 | Cargador de trazos duplicado | **Abierto (justificado)** | Aceptable por ahora (M14). |
| 31 | Gemelo de pinyin | **Corregido** | Borrado; importan `src/pinyin.js`. |
| 32 | Lanzador Chrome ×3, defaults `/tmp` | **Abierto (justificado)** | Unificar puede esperar; los defaults son 1 línea (M21). |
| 33 | puppeteer no declarado | **Parcial** | Usa `CHROME_BIN` y README lo declara; sigue el `import('puppeteer')` (M21). |
| 34 | Código muerto | **Parcial** | Borrado casi todo; quedan los alias de `srs.js` (M21). |
| 35 | Comentarios que mienten | **Corregido** | Los 5 corregidos. |
| 36 | Ajustes y almacenamiento | **Parcial** | `DEFAULTS.locale` quitado; siguen los `MediaQueryList` (M6) y el N+1 de `list()` (I12). |
| 37 | Fugas de temporizador | **Abierto** | Justificación débil: en Pronunciar acierto y fallo se ven igual (M21). |
| 38 | Pinyin de frases con yāo | **Abierto** | 28+28 frases; se arregla junto con I16. |
| 39 | Documentación desactualizada | **Parcial** | CREDITS y puerto OK; quedan `README.md:55`, `VERIFICATION.md` y el comentario de WebLLM (M21). |

Resumen de la tabla: 21 corregidos, 12 parciales, 6 abiertos (3 con justificación aceptable: #28, #30, #32).

---

## Resumen

- **Hay críticos: sí, 4** (C1-C4). 19 importantes y 22 menores.
- **Imprescindibles antes de publicar (🔴):** C1, C2, C3, C4, I1, I2, I7, I18.
- **Imprescindible antes de activar sync (🟠):** I17.
- **Orden recomendado:** C4 (1 línea, protege los datos), I18 (1 línea), C1, C2, C3 + I8 (mismo índice), I5, I2, I1, I7, y después el resto. Cada uno con su test.
- **Los 3 más importantes:**
  1. **C1:** la conversación con OpenRouter no arranca con solo la clave.
  2. **C2 + C3:** la búsqueda en español falla con tildes y sílabas pinyin, y la que funciona descarga ~25 MB.
  3. **C4:** `npm run data` borra el diccionario ES traducido y todo el contenido hecho a mano.
