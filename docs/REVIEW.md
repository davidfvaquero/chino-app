# Revisión final de calidad (thermo-nuclear): chino-app

- Base revisada: commit `09ec099` más el working tree (`VERIFICATION.md` modificado, `scripts/verify-readings.mjs` sin trackear).
- Revisor: opus (tarea t_0381fee6). Solo lectura: no se ha tocado código.
- Estado al revisar:
  - `npm test`: 778/778 en verde (1,7 s).
  - `node scripts/check-es-data.mjs`: 114 archivos, 0 errores.
  - Build `OUT_DIR=… node scripts/build.mjs`: OK, 1846 archivos.

**Veredicto: NO aprobado para publicar. Hay 4 críticos.** Los tests pasan, pero no cubren estos fallos: la mayoría están en rutas reales (fetch, temporizadores, pantallas) que los tests sustituyen por inyecciones.

## Leyenda
- 🔴 **Imprescindible antes de publicar.**
- 🟠 **Imprescindible antes de activar sync** (hoy sync está apagado: `src/sync/config.js` vacío).
- Los números de línea son los de `09ec099`. Si se desplazan, localízalos con el `grep -n` indicado.
- Reglas para quien corrige:
  - Cambio mínimo.
  - Tras cada hallazgo, ejecutar `npm test`.
  - Al final, ejecutar también `node scripts/check-es-data.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.

---

## CRÍTICOS

### 1. 🔴 La clave de OpenRouter y la sesión de sync se filtran en el backup (y en el sync)
- **Dónde:**
  - `src/extras/conversation.js:228`: `storage.set('settings', CONFIG_KEYS.openrouterKey, …)`.
  - `src/backup.js:37-38`: `exportAll` recorre todos los `STORES`.
  - `src/storage.js:23`: `STORES` incluye `meta` y `settings`.
  - `src/sync/merge.js:22`: `SYNC_STORES` incluye `settings`.
- **Qué pasa:**
  - Al exportar el backup, el `.json` descargado lleva en claro `settings.openrouterKey` y `meta.syncSession` (`access_token` y `refresh_token`).
  - Con sync activo, la clave también se sube a Supabase.
  - Además, un import en modo `replace` borra o sustituye la sesión del dispositivo.
- **Por qué importa:**
  - Es un secreto del usuario que sale del navegador.
  - La UI promete lo contrario: `src/locales/en.d/conversation.json:22` dice «saved only in this browser and never uploaded», y `docs/CONVERSATION.md:4` también.
  - Los backups se comparten y se guardan en cualquier sitio.
- **Corrección:**
  1. **Guardar la clave en `meta`, que no se sincroniza.** En `conversation.js`, leer y escribir `openrouterKey` con `storage.get/set('meta', 'openrouterKey')`.
  2. **Migrar una vez dentro de `loadConfig`.** Si `settings.openrouterKey` existe, copiarla a `meta` y hacer `storage.remove('settings','openrouterKey')`.
  3. **Excluir los secretos del backup.** En `src/backup.js`:
     ```js
     const PRIVATE = { meta: new Set(['openrouterKey', 'syncSession', 'syncState']) };
     const isPrivate = (store, key) => PRIVATE[store]?.has(key) ?? false;
     ```
     Saltar esas claves en `readStore`. En `importAll` (borrado `replace` en ~`:103-104` y escritura en ~`:106-111`), ni borrarlas ni escribirlas.
- **Cómo comprobar:**
  - Test nuevo en `tests/backup.test.mjs`: con memoryDriver, `set('meta','syncSession',{access_token:'x'})` y `set('meta','openrouterKey','sk')`. Después, `JSON.stringify(await exportAll(db))` no debe contener `syncSession` ni `sk`, y un `importAll(…, {mode:'replace'})` debe conservar las dos claves.
  - `grep -n "'settings', CONFIG_KEYS.openrouterKey" src/extras/conversation.js` debe salir vacío.

### 2. 🔴 La misma palabra entra varias veces en el mazo de repaso
- **Dónde:** `src/srs.js:57-60` (`cardId`) y `src/srs.js:175-182` (`addToReview`).
- **Qué pasa:** el id depende de qué campos trae cada pantalla. Para 你 salen 5 tarjetas distintas:

  | Pantalla | Id generado |
  |---|---|
  | `screens/dictionary.js:106` | `d4242` |
  | `learn/lessons.js:249` | `x你\|nǐ` |
  | `learn/dictation.js:718` | `x你\|ni3` |
  | `learn/themes.js:338` | `dtheme:你` (pasa `id: 'theme:…'`) |
  | `learn/strokes.js:846` | `x你\|` |
- **Por qué importa:**
  - El usuario repasa la misma palabra varias veces.
  - Se inflan los totales (stats) y las palabras difíciles.
  - El diccionario muestra «no añadida» (`screens/dictionary.js:191`) aunque la palabra ya esté en el mazo.
- **Corrección:** en `addToReview`, después del `get` por id, buscar por contenido:
  ```js
  import { tonelessKey } from './pinyin.js';
  const hz = entry.hanzi ?? entry.simp;
  const py = entry.pinyin ?? entry.pinyinNumeric;
  const same = (await listCards()).find((c) => (c.hanzi ?? c.simp) === hz &&
    (!py || !c.pinyin || tonelessKey(c.pinyin) === tonelessKey(py)));
  if (same) return { card: same, created: false };
  ```
  Y en `src/learn/themes.js:338`, quitar `id: \`theme:${entry.hanzi}\``.
- **Cómo comprobar:** test en `tests/srs.test.mjs` que añade 你 con las 5 formas de entrada de la tabla y exige `listCards().length === 1`. Después, `node --test tests/srs.test.mjs tests/themes.test.mjs`.

### 3. 🔴 Inundación de puntos: el juego Timed lanza `chino:lesson_done` decenas de veces
- **Dónde:** `src/learn/games/timed.js:336-341`. El evento se lanza dentro de `draw()`.
  - El intervalo de `:215-224` llama a `draw()` cada 100 ms hasta que se acaba el tiempo.
  - El `setTimeout` de `:370` llega a la pantalla de resultado sin pasar por `finishGame()`.
- **Qué pasa:** si se terminan las 10 preguntas antes de los 60 s, la pantalla de resultado se repinta y se emiten unos 23 eventos en 2 s. Cada uno vale 50 puntos (`gamification.js:43`) y suma una lección en las estadísticas (`stats.js:36`).
- **Por qué importa:** puntos, nivel, logros y estadísticas quedan falseados. Es visible para el usuario.
- **Corrección:**
  - Mover el `window.dispatchEvent(...)` de `draw()` a `finishGame()`, que ya tiene la guarda `if (finished) return`.
  - En el `setTimeout` de `onAnswer` (`:370`), si `currentIndex >= round.questions.length`, llamar a `finishGame()` en lugar de solo `draw()`.
  - Ver también el hallazgo 10, que quita el `draw()` del intervalo.
- **Cómo comprobar:** test en `tests/games-timed.test.mjs` que cuenta los `chino:lesson_done` tras responder las 10 preguntas y avanzar 2 s con timers falsos: debe ser 1. Prueba manual: terminar rápido una partida y comprobar que los puntos del Perfil suben solo +50.

### 4. 🔴 Pegar texto (Paste): el panel de la palabra nunca se ve
- **Dónde:**
  - `src/extras/paste.js:240`: el panel se crea con `class: 'paste-panel hidden'`.
  - `src/extras/paste.js:67`: la regla `.paste-panel.hidden { display: none; }`.
  - `showWordPanel` (~`:375`) solo hace `panel.hidden = false` y nunca quita la clase.
- **Qué pasa:** al tocar una palabra no aparece nada. Ni significado ni «Añadir al repaso».
- **Por qué importa:** la función principal de la pantalla está rota.
- **Corrección:**
  - Crear el panel con `h('aside', { class: 'paste-panel', hidden: true, 'data-role': 'panel' })`.
  - Borrar la línea 67. El `[hidden]` global de `styles.css:91` ya lo oculta.
- **Cómo comprobar:** test DOM en `tests/paste.test.mjs`: tras analizar el texto y hacer click en una palabra, el panel no tiene `hidden` ni la clase `hidden`. `grep -n "paste-panel hidden" src/extras/paste.js` debe salir vacío.

---

## IMPORTANTES

### 5. 🔴 Los juegos borran la pantalla siguiente tras salir de la ruta
- **Dónde:**
  - Callbacks que siguen vivos: `src/learn/games/matching.js:285`, `memory.js:291` y `timed.js:370`. Son `setTimeout(() => … draw())`.
  - Cleanups que no los paran: `matching.js:297` y `memory.js:306` devuelven `() => {}`; `timed.js:378` solo para el intervalo.
- **Qué pasa:** `draw()` hace `reset(container)` sobre el contenedor del router. Si navegas a otra pantalla menos de ~800 ms después de un fallo, el juego vuelve a pintarse encima.
- **Corrección:** en los 3 juegos:
  - Declarar `let alive = true;`.
  - Poner `if (!alive) return;` como primera línea de `draw()`.
  - Devolver `return () => { alive = false; if (timerId) clearInterval(timerId); };`. En matching y memory no existe `timerId`, así que basta con `alive = false`.
- **Cómo comprobar:** headless o manual. En matching, fallar y pulsar enseguida «Más» → Ajustes: después de 1 s no debe haber `.matching` en el DOM. Después, `node --test tests/games.test.mjs tests/games-timed.test.mjs`.

### 6. 🔴 La lección de Tonos sale en inglés para los usuarios en español
- **Dónde:**
  - `src/learn/tones.js:32-43`: `defaultFetchJson` con un `fetch` propio que se salta `src/data-url.js`. Por eso nunca se carga `public/data/es/lessons/tones.json`, aunque existe y está en `es/files.json`.
  - `src/learn/tones.js:157`: los textos `'Neutral'` y `'1st/2nd/3rd/4th'` están escritos a mano, sin `t()`.
- **Por qué importa:** es la primera lección de un principiante, y sale mitad en inglés.
- **Corrección:**
  - Seguir el patrón de `src/learn/lessons.js:110-111`:
    ```js
    import { fetchData } from '../data-url.js';
    export async function loadLesson({ base = DATA_BASE, fetchJson } = {}) {
      const lesson = fetchJson ? await fetchJson(new URL('tones.json', base)) : await fetchData('lessons/tones.json');
      return { ...lesson, id: LESSON_ID };
    }
    ```
    y borrar `defaultFetchJson`.
  - En la línea 157, usar `t(\`tones.toneName.${word.tone}\`)` con claves 0-4 en `src/locales/en.d/tones.json` y `es.d/tones.json`.
- **Cómo comprobar:** `grep -n "await fetch(\|'Neutral'" src/learn/tones.js` debe salir vacío. Luego `node --test tests/tones.test.mjs` y `node scripts/check-es-data.mjs`.

### 7. Offline: las lecciones y Tonos no se precachean y fallan en una visita en frío sin red
- **Dónde:**
  - `scripts/build.mjs:91-96`: la regex del precache solo incluye `src|icons|fonts`.
  - `sw.js:65`: `dataStrategy` solo busca en `DATA_CACHE`.
- **Qué pasa:** `#/learn/tones` y `#/learn/lessons/hsk1-01` muestran «Failed to fetch» si nunca se abrieron con red. La verificación t_206decef lo confirmó.
- **Corrección:**
  - En `build.mjs:95`, cambiar la regex a `/^(src|icons|fonts)\/|^data\/(es\/)?lessons\/|^data\/(es\/)?files\.json$|^data\/manifest\.json$/`. Son unos 0,5 MB.
  - En `sw.js:65`, `const cached = await caches.match(request);`, que busca en todas las cachés.
  - Corregir el comentario de `build.mjs:89-90`.
- **Cómo comprobar:** `OUT_DIR=/tmp/chino-fix node scripts/build.mjs && grep -c "'data/lessons" /tmp/chino-fix/sw.js` debe dar más de 0. Prueba manual: perfil limpio, cargar `#/home`, desconectar la red y abrir `#/learn/tones`.

### 8. Gamificación: eventos simultáneos pierden puntos y la racha no caduca
- **Dónde:** `src/gamification.js:150-181` (`record`) y `:129-136` (`snapshot`).
- **Qué pasa:**
  - **(a) Puntos perdidos.** `record` hace leer, modificar y guardar sin serializar. Con 3 eventos a la vez se guardó 1 punto en vez de 21. Ocurre al primer evento, mientras se descarga `achievements.json`.
  - **(b) Racha falsa.** `snapshot` devuelve `state.streak` tal cual, así que tras 10 días sin estudiar Home y Perfil siguen mostrando la racha antigua.
- **Corrección:**
  - **(a)** Envolver como ya hace `stats.js:76-95`. Renombrar el `record` actual a `doRecord` y añadir:
    ```js
    let queue = Promise.resolve();
    const record = (e, p) => { const run = queue.then(() => doRecord(e, p)); queue = run.catch(() => {}); return run; };
    ```
  - **(b)** En `snapshot`: `const alive = state.lastDay != null && dayIndex(at) - state.lastDay <= 1;` y devolver `streak: alive ? state.streak : 0`.
- **Cómo comprobar:** en `tests/gamification.test.mjs`, un `Promise.all` de 3 `record` (con los puntos de `EVENTS`) que dé la suma exacta, y un test con el reloj a +10 días que dé `streak === 0`.

### 9. Puntos fáciles de farmear (conversación IA, temas, gramática)
- **Dónde:**
  - `src/extras/conversation.js:448`: `chino:lesson_done` en cada respuesta de la IA.
  - `src/learn/themes.js:281-288`: el botón «Marcar como estudiado» se puede pulsar sin límite.
  - `src/learn/grammar.js:164-178`: lanza el evento aunque el patrón ya estuviera estudiado (el comentario dice «idempotent» y no lo es).
- **Por qué importa:** enviar «a» 10 veces da 500 puntos y 10 «lecciones».
- **Corrección:**
  - **Conversación:** emitir el evento una sola vez por conversación. Usar `state.rewarded`, ponerlo a true al llegar a 5 mensajes del usuario y reiniciarlo en `startNewConversation`.
  - **Temas:** `disabled: Boolean(studied)` en el botón.
  - **Gramática:** emitir solo dentro de `if (!ids.includes(id))`.
- **Cómo comprobar:** tests que cuenten los eventos: 10 envíos con un proveedor falso dan 1 evento, y 2 clics en «estudiado» dan 1 evento.

### 10. El juego Timed repinta todo el DOM cada 100 ms
- **Dónde:** `src/learn/games/timed.js:215-224` (intervalo → `draw()`) y `:345` (`container.focus()`).
- **Qué pasa:**
  - Las clases `correct`/`wrong` que se ponen en `:363-366` se pierden en 100 ms, así que el usuario nunca ve qué opción era la buena.
  - Los toques que caen entre dos repintados se pierden.
  - El foco se mueve 10 veces por segundo, lo que rompe la accesibilidad.
- **Corrección:** guardar una referencia al `<span>` del temporizador (p. ej. `timerEl`) al pintar. En el intervalo, hacer solo `timerEl.textContent = …` y `timerEl.classList.toggle('warning', sec <= 10)`. Quitar `draw()` del intervalo y dejar solo la llamada de fin de tiempo, que pasa por `finishGame()`.
- **Cómo comprobar:** manual. Tras responder, la opción correcta queda marcada en verde 600 ms. `node --test tests/games-timed.test.mjs`.

### 11. Repaso: el botón de audio se desactiva aunque exista el mp3, y calificar avanza aunque falle el guardado
- **Dónde:**
  - **Audio:** `src/screens/review.js:311-321` y `src/learn/hardwords.js:60-68`. Desactivan el botón con `!isTtsAvailable()`, pero `speak()` (`src/audio.js:145-149`) reproduce primero el mp3 pregenerado.
  - **Calificar:** `review.js:477-509` y `hardwords.js:179-208` copian casi línea a línea `rate()` y el evento `chino:review_done`. Si `answer` lanza, igualmente se hace `done += 1` e `index += 1`.
- **Corrección:**
  - **Audio:** quitar `disabled` y el `title` alternativo en los dos sitios. Si `speak()` devuelve `{ok:false}`, mostrar el aviso igual que `screens/dictionary.js:90-93`.
  - **Calificar:** exportar desde `src/srs.js` un `answerAndNotify(id, rating, remaining)` que llame a `answer` y lance el evento, y usarlo en las dos pantallas. En el `catch`, hacer `busy = false; return;` sin avanzar.
- **Cómo comprobar:** `node --test tests/review-screen.test.mjs tests/hardwords.test.mjs`, ajustando la aserción de `disabled` si existe.

### 12. Importar Anki: entidades HTML y homógrafos mal tratados; además se salta la API del mazo
- **Dónde:** `src/anki.js:37` (`unescapeHtml`), `:159` (split por `;`), `:180-192` y `:200-207`.
- **Qué pasa:**
  - `&nbsp;` y `&#39;` no se decodifican, y su `;` parte el significado en trozos: `["particle&nbsp","of completion&#39","s"]`.
  - La deduplicación por hanzi descarta 了 liǎo si ya existe 了 le.
  - Escribe con `db.set('srs', …)` saltándose `addToReview`, así que aplica su propia regla de duplicados.
- **Corrección:**
  - En `unescapeHtml`, antes de `&amp;`, añadir:
    ```js
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    ```
  - Importar con `createDeck(db).addToReview(entry)` y contar `created`. Hacerlo después del hallazgo 2, para que la regla de duplicados sea una sola.
- **Cómo comprobar:** en `tests/anki.test.mjs`, `parseAnkiTsv('#separator:tab\n了\tle\ta&nbsp;b\n').entries[0].english` debe ser `['a b']`, y importar 了 le y 了 liǎo debe dar `added === 2`.

### 13. Router: una pantalla lenta pinta encima de la siguiente
- **Dónde:** `src/router.js:45-62`. No hay control de renders obsoletos.
  - Agrava el problema `src/learn/exam.js:537-543`: carga unos 27 JSON en serie y no muestra texto de carga.
- **Qué pasa:** si navegas mientras un `render` sigue esperando, al terminar pinta sobre la pantalla nueva y su cleanup sustituye al de esa pantalla.
- **Corrección:**
  - En `createRouter`: `let seq = 0;`. En `render`, `const token = ++seq;` antes del `await screen.render(...)`, y después:
    ```js
    if (token !== seq) { if (typeof result === 'function') result(); return route; }
    ```
  - En `exam.js`: pintar `t('common.loading')` antes del `await` y cargar los niveles con `Promise.all`.
- **Cómo comprobar:** test en `tests/router.test.mjs` con dos `render()` seguidos, donde el primero tarda más. El contenedor debe acabar con el contenido del segundo.

### 14. Niveles HSK2/HSK3 mal resueltos (plan y examen)
- **Dónde:**
  - `src/learn/plan.js:58-60`: `lessonLevel()` devuelve `'hsk1'` para `hsk2-*` y `hsk3-*`.
  - `src/learn/exam.js:44`: `LESSON_DIR = { 1: 'hsk1', 2: 'hsk2' }`. El comentario dice que HSK3 no tiene lecciones, pero ya hay 10.
- **Corrección:**
  - `plan.js`: `export const lessonLevel = (id) => LEVELS.find((l) => String(id).startsWith(\`${l}-\`)) ?? 'hsk1';`, importando `LEVELS` de `./lessons.js` (`lessons.js:97`). Si `LEVELS` no incluye `practical`, comprobar `practical` primero.
  - `exam.js`: `const dir = \`hsk${level}\`;` y borrar `LESSON_DIR` y el comentario.
  - `lessons.js:573`: si falta `?level=`, deducirlo del prefijo del id con la misma función.
- **Cómo comprobar:** en `tests/plan.test.mjs`, `assert.equal(lessonLevel('hsk3-05'), 'hsk3')`. Luego `node --test tests/exam.test.mjs tests/plan.test.mjs`.

### 15. Hoja de ejercicios (worksheet): trazos invisibles en modo oscuro y cuadrícula 田 invisible
- **Dónde:**
  - **Trazos:** `src/extras/worksheet.js:140` usa `strokeDiagramSvg` (`src/learn/strokes.js:350`), que pone las clases `.stroke-part` y `.stroke-part-new`. Esas reglas CSS solo existen en `src/learn/strokes-sheet.js:165-166`, y la hoja no las carga. Resultado medido: relleno negro sobre fondo oscuro.
  - **Cuadrícula:** `worksheet.js:141` usa `stroke-width: 0.5` en un viewBox de 1024, lo que da unos 0,02 px.
- **Corrección:**
  - Mover `.stroke-part`, `.stroke-part-new` y `.stroke-pen` al CSS que inyecta `strokes.js`, que es el dueño del SVG, o a `src/styles.css`.
  - Para la cuadrícula: `.ws-cell .tian-grid line { vector-effect: non-scaling-stroke; stroke-width: 1px; }`.
  - Añadir `#/extras/worksheet` a las rutas de `scripts/check-strokes-dark.mjs`.
- **Cómo comprobar:** `node scripts/check-strokes-dark.mjs` (con la ruta añadida) da ≥3:1. `node --test tests/worksheet.test.mjs tests/strokes-dark.test.mjs`.

### 16. Frases: el arreglo tradicional→simplificado se hizo a mano en los datos, fuera del pipeline
- **Dónde:** el commit `db0c348` modificó `public/data/{,es/}sentences/shards/*.json`, pero no `scripts/build-data.mjs:387-400` ni `scripts/build-sentences-es.mjs`.
- **Qué pasa:** 824 de 3000 frases ya no coinciden con la fuente. Un `npm run data` o `npm run data:sentences-es` vuelve a meter caracteres tradicionales, y ningún test lo detecta.
- **Corrección:**
  - En `buildSentences`, convertir `p.zh` con un mapa trad→simp construido con las entradas de un solo carácter de CC-CEDICT (`trad !== simp`).
  - Reutilizar esa conversión en `build-sentences-es.mjs`.
  - Añadir a `tests/data-sanity.test.mjs` un test «ningún carácter solo-tradicional en sentences», con la misma técnica que `tests/hsk3-lessons.test.mjs:78-86`.
- **Cómo comprobar:** el test nuevo pasa. Regenerar en un directorio temporal da 0 diferencias con lo commiteado.

### 17. 🟠 Sync: tal como está no funciona entre dispositivos (latente: sync está apagado)
- **Dónde:** `src/sync/client.js:245-249` (`syncNow`), `:300-304` (`attach`) y `src/storage.js:236-249` (`wrapped`).
- **Qué pasa:**
  - **(a)** `attach()` no se llama en ningún sitio de `src/`. Nunca se encola nada y `updatedAt` no avanza.
  - **(b)** `syncNow` hace push del estado completo antes del pull, con `merge-duplicates`, así que cada dispositivo pisa al otro con su copia vieja.
  - **(c)** `storage.remove` no dispara hooks y `enqueueDelete` no se usa, de modo que los borrados reaparecen.
  - **(d)** `refresh_token` se guarda pero no se usa nunca, y a la hora todo da 401.
  - **(e)** `docs/SYNC.md:94-97` promete «pull on open, push on change».
- **Corrección:** no activar sync hasta arreglarlo. Orden:
  1. `syncNow`: `const pulled = await pull(); if (!pulled.ok) return pulled; return push();`.
  2. `attach`: `return onWrite((c) => (!applying && SYNC_STORES.includes(c.store) ? (c.deleted ? enqueueDelete(c.store, c.key) : enqueue(c)) : undefined));`, y llamarlo en `main.js` `boot()` solo si `isConfigured()`.
  3. En `wrapped` de storage.js, emitir el hook también en `remove` con `{store, key, deleted:true}`.
  4. Reintentar una vez con `POST /auth/v1/token?grant_type=refresh_token` cuando la respuesta sea 401.
  5. Actualizar `tests/sync-client.test.mjs:225` («pushes then pulls»).
- **Cómo comprobar:** test con dos `createSync` sobre memoryDriver y un fetch falso con servidor compartido. A edita y sincroniza, B sincroniza, y B debe ver el valor de A. Borrar en A también debe llegar a B.

### 18. Conversación IA: proveedores obsoletos, sin cancelación y fuga de memoria GPU
- **Dónde:** `src/extras/conversation.js:515` (`reloadProviders` solo al montar), `:439` (`send` sin `signal`), `:521` (cleanup) y `src/chat/providers.js:173-179`.
- **Qué pasa:**
  - **(a)** Al pegar la clave sigue saliendo «no configurado» hasta salir y volver a entrar, y si se cambia la clave se usa la antigua.
  - **(b)** Al salir de la pantalla, el fetch o la generación siguen corriendo.
  - **(c)** Cada visita crea un engine WebLLM nuevo (≈1 GB de GPU) sin liberar el anterior.
- **Corrección:**
  - **(a)** En el `change` de los campos de clave, URL y select, llamar a `reloadProviders()` y luego `paint()`.
  - **(b)** `state.ctrl = new AbortController(); provider.send(payload, { signal: state.ctrl.signal })`, y en el cleanup `state.ctrl?.abort()`. En `streamLines` (`providers.js:54-70`), `try { … } finally { reader.cancel().catch(() => {}); }`.
  - **(c)** Memoizar:
    ```js
    let onDevice;
    export async function loadOnDeviceProvider() { try { return onDevice ??= (await import('./webllm-provider.js')).createProvider(); } catch { return null; } }
    ```
- **Cómo comprobar:** tests en `tests/chat-providers.test.mjs`. Dos `loadOnDeviceProvider()` deben devolver el mismo objeto (`===`), y un proveedor falso debe ver `signal.aborted === true` tras el cleanup.

### 19. Duplicación de helpers canónicos en Learn y juegos (`shuffle` sesgado, carga de palabras)
- **Dónde:**
  - **`shuffle` en 8 copias:**
    - Fisher-Yates: `src/learn/exam-gen.js:82`, `dictation.js:270`, `games/tones-duel.js:85` y `games/builder.js:174`.
    - Sesgadas, con `sort(() => Math.random() - 0.5)`: `typing.js:204`, `games/matching.js:68,82`, `games/timed.js:76,91,101` y `games/memory.js:75`. Medido: P(el primero sigue primero) = 0,28 en vez de 0,25. Además, `timed.js:91` muta el pool.
  - **`loadWords`** idéntico en `games/matching.js:104`, `memory.js:122` y `timed.js:131`.
  - **`normalizeWord` y `englishText`** duplicados en `exam-gen.js:95,104` y `dictation.js:247,257`.
- **Corrección:**
  - Crear `src/random.js` con el `shuffle` de `exam-gen.js` (con `rng` inyectable). `exam-gen.js` y `dictation.js` lo reexportan para no romper los tests.
  - Sustituir todos los `sort(() => Math.random() - 0.5)`.
  - Crear `src/learn/games/common.js` con `loadWords(source)` y que lo importen los 3 juegos.
- **Cómo comprobar:** `grep -rn "Math.random() - 0.5" src` y `grep -c "async function loadWords" src/learn/games/*.js` deben salir vacíos o a 0. Luego `npm test`.

### 20. Tonos copia el motor de lecciones, y la copia ya se ha desviado
- **Dónde:** `src/learn/tones.js:178-288` duplica `exerciseView`, `choiceBody`, `finish`, `resultStep` y `saveProgress` de `src/learn/lessons.js:277-562`.
- **Qué pasa:** el `choiceBody` de tonos (`:238-256`) no marca `is-correct`/`is-wrong`/`is-missed`, así que al fallar no se ve la respuesta buena, y no tiene barra de progreso. Además, `src/learn/exercise-ui.css.js:3` dice que lo usan «exam and games», y es falso.
- **Corrección:**
  - Exportar `exerciseView`, `choiceBody`, `finish` y `progressBar` desde `lessons.js`, o moverlos a un `src/learn/exercise-view.js` nuevo.
  - En `tones.js`, importarlos y quedarse solo con lo propio (`pinyinStep`).
  - Corregir el comentario.
- **Cómo comprobar:** `grep -n "function choiceBody" src/learn/*.js` debe dar 1 resultado. Luego `node --test tests/tones.test.mjs tests/exercise-ui.test.mjs`.

### 21. Tests por lotes con huecos de cobertura, y validadores sueltos que no se ejecutan
- **Dónde:**
  - **Tests por lotes:** `tests/readings-28-34.test.mjs:12`, `tests/hsk3-lessons-02-04.test.mjs` y `tests/hsk3-lessons-8-10.test.mjs:13` tienen listas fijas. Ningún test cubre hsk3-05..07, y las lecturas 02-27 y 35-40 no tienen chequeo de segmentación.
  - **No se ejecutan nunca:** `tests/check-readings.mjs` (el glob de `package.json:10` no lo coge), `scripts/verify-readings.mjs` (sin trackear, lecturas 21-27 fijas), `scripts/validate-hsk3-8-10.mjs` y `scripts/validate-lessons.mjs`.
- **Corrección:**
  - Crear un único `tests/content-data.test.mjs` que recorra con `readdirSync` todas las lecciones y lecturas de cada `index.json`, con los checks que hoy hacen esos archivos: esquema, tipos de ejercicio, respuesta calificable, segmentable y sin tradicional.
  - Borrar los 3 tests por lotes y los 4 scripts sueltos.
  - Como sigue en verde hoy (sondeado), no rompe nada.
- **Cómo comprobar:** `npm test` en verde, con un subtest por cada lección y lectura.

---

## MENORES
Corregir solo si cuestan 1-3 líneas. El resto, dejarlo anotado.

22. **Rutas absolutas en scripts.** `scripts/build-radicals.mjs:4` y `scripts/build-etymology.mjs:26` usan `path.resolve('/home/homelab/chino-app')`.
    - **Corrección:** `const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');` con `import { fileURLToPath } from 'node:url'`.
    - **Comprobar:** `grep -n "/home/homelab" scripts/*.mjs` ya no muestra esas líneas.
23. **SW en `npm run dev`.** Con `VERSION='dev'`, `sw.js` hace cache-first para siempre y sirve módulos viejos. La lista `SHELL_ASSETS` de `sw.js:12-36` es código muerto (el build la reemplaza) y está desactualizada. El parámetro `event` de `shellStrategy` (`:76`) no se usa.
    - **Corrección:** `const DEV = VERSION === 'dev';` y, en el listener de fetch, `if (DEV) return;`. Reducir la lista a `['./', './index.html']` con el comentario «build.mjs injects the full list».
24. **Check tautológico en el build.** `scripts/build.mjs:107-116` (sanity check): su regex solo encaja con `'./'`, que se salta, así que no comprueba nada.
    - **Corrección:** borrarlo.
25. **Negativos de red cacheados en `src/data-url.js:111-119` y `:136-143`.** Un fallo de red al arrancar se guarda como «no hay datos en español» hasta recargar.
    - **Corrección:** en los `catch`, `if (err instanceof TypeError) { manifestTried = false; /* o */ existence.delete(key); }`.
26. **Helper de «día local» repetido 6 veces.**
    - Copias: `screens/home.js:30-38`, `stats.js:46-49`, `learn/plan.js:53-55`, `gamification.js:70-73`, `extras/backup.js:51-52` y `anki.js:209-212`.
    - **Corrección:** crear `src/day.js` con `localDayKey(date)` y `localDayNumber(date)`, y reexportarlos con los nombres actuales.
27. **Eventos `chino:*` definidos en 3 tablas:** `stats.js:34-41`, `gamification-wire.js:9-16` y `gamification.js:41-48`.
    - **Corrección:** que `gamification-wire.js` derive el mapa con `Object.fromEntries(Object.keys(EVENTS).map((k) => [\`chino:${k}\`, k]))`.
28. **CSS inyectado desde JS, unas 30 copias de `ensureStyles`.** `paste.js:34-40` y `account.js:31-34` reimplementan `.btn`, y `conversation.js:54` reimplementa `.chip`.
    - **Corrección:** crear `injectCss(id, css)` en `src/dom.js` y migrar poco a poco. Quitar las clases duplicadas.
29. **`src/learn/strokes.js` (979 líneas) lleva dos motores de animación.** `createStrokeAnimation` (`:363-454`) y el de `createStrokeApp` (`:601-665`) son el mismo algoritmo. El primero no avisa al terminar, así que el botón de `strokes-sheet.js:286-290` se queda en «Pausa».
    - **Corrección:** añadir `onDone` a `createStrokeAnimation`. Más adelante, partir el archivo en geometría, datos, SVG y pantalla, manteniendo los re-exports.
30. **Cargador de trazos duplicado.** `src/extras/strokematch.js:240,266` vuelve a descargar `strokes/index.json` y los shards, con la ruta fija en el código.
    - **Corrección:** reutilizar `createStrokeLoader` de `strokes.js:220`.
31. **`scripts/lib/pinyin.mjs` es gemelo de `src/pinyin.js`.** Dan 0 diferencias en 125.427 lecturas.
    - **Corrección:** importar `../src/pinyin.js` en `build-data.mjs:40` y `tests/data-sanity.test.mjs:14`, y borrar el gemelo.
32. **Lanzador Chrome/CDP repetido 3 veces.** Está en `scripts/check-layout.mjs` y `scripts/check-exercises.mjs`, cuando `scripts/lib/audit.mjs` ya lo tiene. Además, hay rutas `/tmp` caducadas por defecto en `check-contrast.mjs:26` y `check-layout.mjs:27`.
    - **Corrección:** importar de `audit.mjs`, y usar `dist/` como valor por defecto.
33. **Dependencia no declarada.** `scripts/check-tones-headless.mjs:33` importa `puppeteer`, que no está en `package.json`. `README.md:16` y `CREDITS.md:121-124` dicen «sin dependencias».
    - **Corrección:** borrar el script, porque `audit.mjs` cubre lo mismo.
34. **Código muerto.**
    - `src/speech.js:139-156` (`speechAvailable`, `speak`, `resetVoiceCache`).
    - `src/dictionary.js:277-280` (`withToneMarks`).
    - Alias `gradeCard`, `dueCards` y `schedule` de `src/srs.js:200,215-219`, que solo usan los tests.
    - `wordKey` en `exam-gen.js:352`.
    - `scripts/dev.mjs` (`docs/CONVENTIONS.md:136` lo da por superado).
    - `isFree` en `conversation.js:525-528` (usar `freeModels` de `providers.js`).
    - `isRecognitionAvailable` duplicado en `extras/pronounce.js:209-212` (importarlo de `speech.js:28`).
35. **Comentarios que mienten.**
    - `gamification.js:25-30` dice que no existe `en.d`, pero existe.
    - `main.js:75` dice «hard-codes 5 columns», pero son 6.
    - `plan.js:10-11` dice que se completa solo, pero no hay ningún listener.
    - `screens/extras.js:38` dice que `styles.css` está «frozen».
    - `dom.js:13` dice que `html:` es solo para SVG, pero también se usa con `pinyinHtml`, que escapa.
36. **Ajustes y almacenamiento.**
    - `src/settings.js:30`: `DEFAULTS.locale` existe pero no está en `ALLOWED`, así que es una clave falsa.
    - `settings.js:90-95`: quita el listener de un `MediaQueryList` distinto al que lo añadió, y los listeners se acumulan.
    - `src/storage.js:148-153`: `list()` de IndexedDB abre una transacción por clave (N+1).
37. **Fugas de temporizador.**
    - `src/extras/pronounce.js` no devuelve cleanup: el `setTimeout` de `:139` y `listen()` sobreviven al cambio de ruta. Además, `.pronounce-feedback.correct` y `.try-again` no tienen CSS, así que acierto y fallo se ven igual.
    - En `src/learn/sentences.js:40,182,242`, `cleanupFns` nunca se llena y el timer del filtro no se cancela.
38. **Pinyin de frases con polifonía errónea.** 29 frases llevan «yāo» (ej. 我要走了 → «wǒ yāo zǒu le»), porque `scripts/build-data.mjs:368-382` (`scoreOf`) no prioriza las lecturas HSK.
    - **Corrección:** sembrar `wordPinyin` primero con las listas HSK.
39. **Documentación desactualizada.**
    - `CREDITS.md` no menciona WebLLM (jsDelivr), los pesos Qwen2.5 ni OpenRouter.
    - En `README.md`, la línea 17 dice «localhost:5173», pero el puerto es aleatorio, y la línea 52 dice «Lessons (hsk1)», pero hay hsk1-3 y practical.
    - `VERIFICATION.md` tiene 2279 líneas de log de workers en la raíz y debería resumirse.
    - `src/chat/webllm-provider.js:6` afirma «works offline after that», pero depende de la caché HTTP y no del SW.

---

## Resumen
- **Sin críticos: NO.** Hay 4 críticos, 17 importantes y 18 menores.
- **Imprescindibles antes de publicar (🔴):** 1, 2, 3, 4, 5, 6.
- **Imprescindible antes de activar sync (🟠):** 17.
- **Lo mejor del código:**
  - SRS puro e inyectable.
  - `merge.js` determinista.
  - Build con hash y comprobación de claves i18n duplicadas.
  - Sin XSS: `h()` usa `textContent` y `pinyinHtml` escapa.
  - `styles.css` limpio de colores fijos.
  - Suite sin dependencias y rápida.
- **Lo peor:**
  - Lógica canónica copiada: shuffle, loaders, días, motor de ejercicios.
  - Pantallas que no limpian temporizadores.
  - Tests que usan rutas inyectadas distintas de las de producción, y por eso no ven los fallos reales (6, 7, 4).
