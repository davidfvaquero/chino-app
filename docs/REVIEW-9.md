# Revisión de calidad thermo-nuclear, ronda 9 (delta): chino-app

- **Base revisada:** `HEAD` = `80c1b99`. Delta desde `5b08fb0` (REVIEW-8, `git log -1 --format=%H -- docs/REVIEW-8.md`): 2 commits y 57 archivos. 45 de ellos son shards de ejemplos regenerados.
- **Ámbito:** las correcciones de REVIEW-8 (I1 y M1-M6), los archivos que tocan y sus vecinos: `sync/client.js` (`enqueueDelete`, `attach`, `schedulePush`), `sw.js` (`dataStrategy`), `random.js`, `main.js` (`flash`) y `screens/dictionary.js` (ejemplos).
  - El delta toca seguridad (CSP), datos (`secrets.js`) y el pipeline de ejemplos. Esas zonas se releyeron enteras. El router no cambia.
- **Revisor:** opus (tarea t_7ef83c3c). Solo lectura. El único archivo nuevo es este informe.
- **Método:**
  - Copia limpia con `git archive HEAD`: `npm test`, `check-i18n`, `check-es-data` y el build, con revisión de la CSP y del `DATA_CACHE` generados.
  - Regeneración de los ejemplos en la copia con las fuentes de `data-work/examples/`. La salida es idéntica a la de `HEAD` (`diff -rq` vacío).
  - Comandos de comprobación de REVIEW-8 I1 y búsqueda de bigramas con 着 en las 38 381 frases.
  - 12 mutaciones sobre el código del delta (tabla).
  - Las tareas madre t_d03eb1bf (mecánica: `check-*` en verde, precache de 518 entradas sin `data/dict`) y t_e39cfae3 (visual: es/en × claro/oscuro, 0 errores de consola, I1 bien en pantalla) cubren el resto. No las repetí.

## Veredicto: **APROBADO para publicar**

**Sin críticos, sin importantes y 6 menores.**

- El único importante de REVIEW-8 (I1, ejemplos) está corregido de verdad. Quedan 0 frases con 显着, 土着 o 昭着 y 0 con 这只是 leído `zhī`. Las fichas de 宁 y 尽 tienen sus 4 ejemplos con `níng` y `jìn`. Dos tests nuevos fijan las tres cosas.
- M1 (CSP sin `data:`), M3 (el examen ya no cuenta como lección HSK), M5 (desempate simplificado sin cambiar la salida) y M6 (test de sílabas) están corregidos, y sus mutaciones mueren.
- Los menores que quedan son de calidad de datos residual (1 frase con 所着 y 21 con el tradicional 閒), de tests que faltan y de un duplicado de `notice`. Ninguno bloquea.

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` (copia limpia) | 1411/1411 en verde (eran 1325) |
| `check-i18n` | OK, 1067 claves, todas traducidas |
| `check-es-data` | 209 archivos, 0 errores |
| Build | OK, 2537 archivos. `DATA_CACHE` = `002ad218a559`, sin cambios. Es correcto: los ejemplos no son cache-first (`sw.js:61`), van por stale-while-revalidate y el shard corregido llega en la siguiente visita |
| CSP generada | `connect-src 'self' https:`, sin `data:`. `grep` de `fetch(` con `data:` o `blob:` en `src` da vacío |
| `build-examples.mjs` reproducible | Sí, con las fuentes de `data-work/examples/`: 64 shards idénticos (ver M6) |
| I1: `显着\|土着\|昭着` / `这只是…zhī shì` / `níng sǐ\|Níng wèi` | 0 / 0 / 6 |
| `[这那]只[是不有能要会]` | 12 frases, las 12 con `zhǐ` y todas son el adverbio |
| Duplicados dentro de una clave de ejemplos | 0 de 14 630 claves |
| Archivos de código > 1000 líneas | Ninguno. El mayor es `src/learn/dictation.js` con 774. `build-examples.mjs` tiene 565 |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| `git status --short` | vacío |

### Mutaciones (código del delta y supervivientes de REVIEW-8 M2)

| Mutación | Resultado |
|---|---|
| `exam.js` `examLevel` → `level` | muere |
| `main.js` `retireLegacySecrets` → `migrateSecrets` | muere |
| `secrets.js` `retireLegacySecrets` sin el bucle de `enqueueDelete` | muere |
| `lessons.js:389` `orderBody` sin `orderPool` | muere |
| `reading-14` `Hěn hǎowán` → `Hěn wán` | muere |
| `index.html` vuelve a poner `data:` en `connect-src` | muere |
| `dialogues.js` `shuffle` como identidad | muere |
| `notice.js` sin el `requestAnimationFrame` (REVIEW-8 M4) | **sobrevive** (M3) |
| `tones.js:235` `level: 'tones'` → `'hsk1'` | **sobrevive** (M4) |
| `index.html:33` sin `role="status" aria-live="polite"` | **sobrevive** (M4) |
| `home.js:216` sin `pluralKey` | **sobrevive** (M4) |

## Reglas para quien corrige

- Ningún menor bloquea la publicación. Si se corrigen, empieza por M1 y M2 (datos, 1-2 líneas y regenerar), luego M3.
- Las líneas son de `80c1b99`. Si se mueven, búscalas con el `grep -n` indicado.
- Regenera los ejemplos con `npm run data:examples`, usando las fuentes ya descargadas en `data-work/examples/` (no borres esa carpeta: ver M6). Commitea solo el diff de `public/data/examples`.
- No edites `docs/REVIEW-*.md`. Al final pasa `npm test`, `node scripts/check-es-data.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

Sin importantes.

---

## MENORES

### M1. Ejemplos: queda una frase con 所着 por 所著
- **Dónde:** `scripts/build-examples.mjs:181` (regla de 著 en `simplify`). Afecta a 1 frase: `孙子所着的兵法，至今仍是各国军事学院的必读经典。`, con pinyin `suǒ zhe`.
- **Qué pasa:** la lista de caracteres previos que conservan 著 no incluye 所. 所著 («escrito por») es el mismo caso que 编著 o 论著. Lo introdujo REVIEW-7 (en `b2a7fef` había 0) y REVIEW-8 no lo vio.
  - Además, la clase compara `text[i - 1]`, que es el carácter **original**. En una frase en tradicional, 編著, 論著, 專著 y 遺著 llevan delante 編/論/專/遺, que no están en la clase. Hoy no hay ninguna en el corpus (0 en los shards), así que es un riesgo latente. 顯著 solo se salva por el `replaceAll('显着', '显著')` de `:186`.
- **Por qué importa:** es poco (1 frase de 38 381), pero es justo el tipo de error que bloqueó REVIEW-8.
- **Corrección:** en `:181`, compara contra el carácter ya simplificado y añade 所:
  ```js
  const before = toSimplified(text[i - 1] ?? '', tradSimp);
  out += next === '名' || next === '作' || next === '称' || /[显土昭卓原巨编论专遗拙所]/.test(before) ? ch : '着';
  ```
  Así el `replaceAll('显着', '显著')` de `:186` solo sigue haciendo falta para las 2 erratas de Tatoeba. Añade `'所着'` a la lista del test `tests/examples-data.test.mjs` («no 土着/显着/昭着»).
- **Cómo comprobar:** regenera y ejecuta `grep -o '所着\|显着\|土着\|昭着' public/data/examples/shards/*.json | wc -l`, que debe dar 0. `grep -o '所著' public/data/examples/shards/*.json | wc -l` debe dar al menos 1.

### M2. Ejemplos: 閒 sigue en tradicional en 21 frases
- **Dónde:** `scripts/build-examples.mjs:171` (`EXTRA_TRAD`). Por ejemplo, `你在閒暇的时候一般做什么？` y `閒聊`.
- **Qué pasa:** `toSimplified` no convierte 閒, porque en el diccionario es ambiguo (闲/间). En todas las frases del corpus es 闲 (`xián`, el pinyin ya sale bien). Viene de antes del delta: en `b2a7fef` había 21 y en `5b08fb0`, 22.
- **Por qué importa:** el alumno ve un carácter tradicional en una app que muestra simplificado. Es el mismo tipo de caso que 於 y 乾, que ya se arreglaron así.
- **Corrección:** añade `閒: '闲'` a `EXTRA_TRAD` en `:171` y regenera. Opcional: añade `'閒'` a la lista de `tests/examples-data.test.mjs` que prohíbe 於 y 乾净 (`grep -n "於" tests/examples-data.test.mjs`).
- **Cómo comprobar:** `grep -o '閒' public/data/examples/shards/*.json | wc -l` da 0 y `npm test` pasa.

### M3. El arreglo del aviso accesible (REVIEW-8 M4) no tiene test y deja un duplicado
- **Dónde:** `src/notice.js:12-21` y `src/main.js:101-109` (`flash`).
- **Qué pasa:**
  - Si se quita el `requestAnimationFrame`, que es justo el arreglo, `npm test` sigue en verde. Ningún test importa `notice.js` (`grep -rln "notice" tests` da vacío).
  - `flash()` de `main.js` escribe en el mismo `#app-status` con la lógica antigua: texto e `hidden = false` a la vez, y un temporizador propio (`flash.timer`). Así, el aviso de ruta desconocida (`main.js:121`) tiene el problema de anuncio que M4 corregía. Si un `flash` y un `notice` coinciden, el temporizador del primero oculta el segundo antes de tiempo.
- **Por qué importa:** son dos implementaciones del mismo toast, y la canónica no está protegida.
- **Corrección:**
  1. Borra `flash` de `main.js`. En `:121` usa `notice('errors.routeMissing', { screen: route.unknown })`, importando `notice` desde `./notice.js`.
  2. Añade un test en `tests/` con `installFakeDom` (de `tests/helpers/fake-dom.mjs`). Debe crear `#app-status` con `hidden`, llamar a `notice(...)` y comprobar dos cosas: justo después, `hidden === false` y `textContent === ''`; tras un `setTimeout(0)`, el texto ya traducido.
- **Cómo comprobar:** la mutación «`notice.js` sin `requestAnimationFrame`» debe morir, y `grep -n "function flash" src/main.js` debe dar vacío.

### M4. Tres arreglos de REVIEW-7 siguen sin test (resto de REVIEW-8 M2)
- **Dónde:** `src/learn/tones.js:235` (`level: 'tones'`), `index.html:33` (`role="status" aria-live="polite"`) y `src/screens/home.js:170`, `:177` y `:216` (`pluralKey`).
- **Qué pasa:** las tres mutaciones de la tabla sobreviven. REVIEW-8 M2 pedía un test de una línea para cada una, y en el delta solo se hicieron los dos principales (lápida y Ordenar).
- **Corrección:** añade a `tests/review8.test.mjs` tres tests con `readSource`, igual que el de `exam.js`:
  - `assert.match(readSource('src/learn/tones.js'), /level: 'tones'/)`.
  - `assert.match(readSource('index.html'), /id="app-status"[^>]*role="status"[^>]*aria-live="polite"/)`.
  - `assert.equal((readSource('src/screens/home.js').match(/t\(pluralKey\(/g) || []).length, 3)`.
- **Cómo comprobar:** repite las tres mutaciones. Deben morir.

### M5. Pequeña deuda en el delta
- `src/learn/dialogues.js:92` `export { shuffle }` es una reexportación que solo existe para `tests/dialogues.test.mjs:21`. Importa `shuffle` desde `../src/random.js` en el test y borra la reexportación. Ojo: la versión antigua aceptaba algo que no fuera un array, y `random.js` no. Los dos llamantes (`:111` y `:131`) pasan arrays, así que no cambia nada.
- `scripts/build-examples.mjs`: el caso especial de 的哥 sigue duplicado (`:267-268` y `:384-385`). La clase de numerales y `adverbZhi` están copiadas en `tests/examples-data.test.mjs:255-258`. Como el test valida datos y no el script, la copia se puede aceptar. Si se quiere unificar, exporta `MEASURE_BEFORE` y `adverbZhi` desde un módulo pequeño (`scripts/lib/zhi.mjs`) que importen los dos.
- En el diccionario, cada fila de un carácter polífono abre los mismos 4 ejemplos (`screens/dictionary.js:216-225` y `examplesFor(word)` por `simp`). Por eso la fila `zhù` de 宁 enseña frases con `níng`, y t_e39cfae3 vio 我宁死不降 5 veces. Viene de antes y no hay datos duplicados (0 claves con frases repetidas). Para corregirlo, muestra el bloque de ejemplos solo en la primera fila de cada `simp` dentro de los resultados.

### M6. La regeneración de ejemplos depende de una descarga sin fijar
- **Dónde:** `scripts/build-examples.mjs:39` y `:48-53`, y `.gitignore` (`data-work/`).
- **Qué pasa:** con las fuentes que ya hay en `data-work/examples/`, regenerar da exactamente `HEAD`. Desde un clon limpio, el script descarga el volcado actual de Tatoeba y cambian 16 shards (lo midió t_d03eb1bf). El volcado usado no queda registrado en `public/data/examples/index.json`.
- **Por qué importa:** los arreglos de los ejemplos (I1 de REVIEW-8) solo se pueden verificar al bit en esta máquina. No bloquea, porque los shards están versionados.
- **Corrección:** guarda en `index.json` la fecha (`Last-Modified`) y el sha256 de cada `.bz2` usado, y documenta en el comentario de cabecera que regenerar con otro volcado cambia frases. Fijar el volcado en el repo no compensa (pesa decenas de MB).
- **Cómo comprobar:** `grep -o '"sha256"' public/data/examples/index.json | wc -l` da 6.

### Abiertos de rondas anteriores que siguen igual (menores aceptados)
Siguen tal cual los de REVIEW-8 M7. No se tocaron y ninguno bloquea:
- **Diálogos:** distractores de «Eres B» con dos respuestas válidas, y 一 sin sandhi en 6 líneas.
- **Lecturas:** `Bùguò` en hsk3/04:22 y `bù tài` en hsk3/15:29, sin nota en `docs/reading-schema.md`.
- **Créditos:** `CREDITS.md:84` sigue diciendo «carry no author» y no hay enlace por frase a Tatoeba.
- **Mantenibilidad:** dos contadores diarios, `pluralKey`/`formatDate`/`dayNumberFromKey` duplicados, CSS desde `ensureStyles`, `window.__gamification` (`gamification-wire.js:40`) y `areas.length > 4` (`extras.js:101`).
- **Otros:** puppeteer sin `devDependencies`, `docs/AUDIO.md:149` «1 104 clips», `es/lessons/hsk4/lesson-08.json:189` «someterse a», y `hsk2/reading-18` con `speaker: ""` en 7 líneas.
- **Accesibilidad (REVIEW-7 M3):** calendario por filas, fecha ISO, foco del chip de meta y `aria-valuetext`.

---

## Lo que está bien (verificado en esta ronda)

- **I1 (ejemplos):** las cuatro partes de la corrección propuesta están aplicadas tal cual (`build-examples.mjs:181`, `:186`, `:233-236` y `:339-340`).
  - Con las fuentes locales, regenerar da los mismos shards que `HEAD`.
  - 显著 sale 14 veces, 著名 25, 原著 2 y 著作 2, sin ningún 着 erróneo en esas palabras.
  - Los 12 [这那]只[是不有能要会] son el adverbio y salen con `zhǐ`.
  - El test de `:254` salta ese caso y hay dos tests nuevos (`zhǐ`, y no 土着/显着/昭着). El test que fijaba el error está arreglado.
- **M1 (CSP):** `check-strokes-orient` decodifica con `Blob` (`:109`), `connect-src` no lleva `data:` y el test lo exige.
- **M2 (cableado):** `retireLegacySecrets(storage, sync)` es una sola costura que usan `main.js:136` y el test I2.
  - Llamarla antes de `attach` es seguro: `enqueueDelete` (`client.js:405`) escribe la lápida en el estado y no depende de la suscripción. Sin sync configurada devuelve `NOT_CONFIGURED`, como antes.
  - El test de Ordenar renderiza la lección real `hsk2-04` y comprueba el `.pool-row`. Tiene guarda contra el test vacío.
- **M3 (examen):** envía `examLevel`, nadie más lee `detail.level` y el test de gamificación comprueba el comportamiento (el examen solo no desbloquea, una lección sí).
- **M5:** `makeSentencePinyin` queda con un solo ternario, sin `maxWordLen` y con `MEASURE_BEFORE` como constante. El comentario de `:334` ya es verdad, y la salida no cambia.
- **M6:** el test de sílabas recorre todas las lecturas, explica sus dos excepciones (erhua y 一 reducido) y muere con `Hěn wán`.
- **`shuffle`:** queda una sola implementación (`src/random.js`).
- **Higiene:** 0 coautores, `git status` vacío y ningún archivo de más de 1000 líneas. Los archivos fuera de `src/public/scripts/tests/docs` son los de siempre.

---

## Estado de los hallazgos de `docs/REVIEW-8.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| I1 | El arreglo de I3/I4 mete errores de hanzi y pinyin | **Corregido de verdad** | Los tres `grep` dan 0/0/6, 宁 y 尽 están bien y 2 tests nuevos. Queda 1 frase con 所着 (M1), de la misma regla |
| M1 | `data:` en `connect-src` | **Corregido de verdad** | La mutación muere |
| M2 | Tests del helper y no del cableado | **Parcial** | Lápida y Ordenar corregidos (las mutaciones mueren). Tonos, `role="status"` y `pluralKey` siguen sin test (M4) |
| M3 | El examen cuenta como lección HSK | **Corregido de verdad** | Test de comportamiento y mutación que muere |
| M4 | El aviso de logro puede no anunciarse | **Parcial** | `notice.js` corregido, pero sin test, y `flash()` duplica el toast sin el arreglo (M3). El resto de REVIEW-7 M3 sigue abierto |
| M5 | Desempate muerto en `makeSentencePinyin` | **Corregido de verdad** | Código simplificado y salida idéntica. 的哥 sigue duplicado (M5) |
| M6 | Falta el test de sílabas | **Corregido de verdad** | Muere con `Hěn wán` |
| M7 | Abiertos de REVIEW-7 | **Abierto** (aceptado) | Solo se cerró el `shuffle` duplicado |

Resumen de la tabla (8): 5 corregidos de verdad, 2 parciales (solo menores) y 1 abierto aceptado. No queda ningún importante abierto.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** sin importantes.
- **Menores:** 6 (M1-M6), más los abiertos aceptados de rondas anteriores.
- **Veredicto:** APROBADO para publicar.
- **Los 3 más importantes:**
  1. **M1:** queda 1 frase con 所着 por 所著, y la regla de 著 mira el carácter original en vez del simplificado. Basta 1 línea en `build-examples.mjs:181`, regenerar y añadir `'所着'` al test.
  2. **M2:** 閒 aparece en tradicional en 21 frases. Basta añadir `閒: '闲'` a `EXTRA_TRAD` y regenerar.
  3. **M3:** el arreglo del aviso accesible no tiene test, y `flash()` de `main.js` duplica el toast sin el arreglo. Hay que borrar `flash`, usar `notice` y añadir un test con DOM falso.
