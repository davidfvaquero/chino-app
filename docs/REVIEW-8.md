# Revisión de calidad thermo-nuclear, ronda 8 (delta): chino-app

- **Base revisada:** `HEAD` = `88126eb`. El delta va de `b2a7fef` (REVIEW-7) a `HEAD`: 7 commits y 111 archivos. De ellos, 64 son shards de ejemplos regenerados y 20 son lecciones, lecturas y diálogos.
  - `git log -1 --format=%H -- docs/REVIEW-7.md` devuelve `b2a7fef`.
- **Ámbito:** las correcciones de REVIEW-7: I1 (CSP), I2 (historial privado), I3/I4 (ejemplos), I5 (contenido), I6 (Ordenar) y los menores baratos.
  - El delta toca seguridad (CSP), datos (`secrets.js` y la migración) y sync (lápida tras `attach`). Esas zonas se releyeron enteras: `sync/client.js` (`collectLocal`, `push`, `pull`, `enqueueDelete`), `backup.js` y `sw.js`.
- **Revisor:** opus (tarea t_55a9e3df). Solo lectura. El único archivo nuevo es este informe.
- **Método:**
  - Copia limpia con `git archive HEAD`: `npm test`, `check-i18n` y el build, con medición del precache.
  - **Regeneración de los ejemplos** en una copia con `node scripts/build-examples.mjs`. La salida es idéntica a la de `HEAD` (`diff -rq` vacío).
  - Comparación frase a frase del pinyin de `b2a7fef` frente a `HEAD` (24 195 frases comunes, 259 cambian) y clasificación de cada sílaba cambiada.
  - Tres variantes del script en la copia para probar la corrección propuesta. La propuesta de I1 está **verificada**: 48 frases arregladas y 0 hanzi incorrectos.
  - 12 mutaciones sobre el código del delta.
  - Las tareas madre t_526312a0 (mecánica, `check-*` en verde) y t_9ddeec48 (visual, 0 errores de consola y 0 px de scroll horizontal) cubren el resto. No las repetí.

## Veredicto: **NO APROBADO para publicar**

**Sin críticos. 1 importante y 7 menores.**

- Las correcciones de REVIEW-7 están bien hechas en casi todo: I1, I2, I5 e I6 están corregidos de verdad.
- **Ejemplos (I1):** el arreglo de I3/I4 mete errores nuevos del mismo tipo que corregía:
  - Escribe 显着, 土着 y 昭着 (22 frases), cuando lo correcto es 著.
  - Lee 这只是 y 那只是 con `zhī` (12 frases).
  - Al sacar el pinyin del texto simplificado se pierde la lectura que daba el tradicional. Las fichas de **宁** y **尽** muestran sus 4 ejemplos con la lectura mal (`zhù` y `jǐn`).
  - Un test fija uno de los errores como correcto.
  - Parte de la culpa es de REVIEW-7: la regla «只 detrás de 这/那 → `zhī`» la propuse yo, y era demasiado amplia.
- La corrección cuesta 5 líneas del script, una regeneración y retocar un test. Está probada en una copia (detalle en I1).

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` (copia limpia) | 1325/1325 en verde |
| `check-i18n` | OK, 1067 claves, todas traducidas |
| Build | OK, 2537 archivos. `DATA_CACHE` = `002ad218a559`, sin cambios (correcto: no cambia ningún dato cache-first) |
| Precache del SW | Pasa de 456 entradas y 2,37 MB a **518 entradas y 2,49 MB**. Lo nuevo son los diálogos en/es (REVIEW-7 M1). Siguen fuera los ejemplos, el audio y el diccionario |
| `build-examples.mjs` reproducible | Sí: regenerar da los mismos 64 shards |
| Pinyin de ejemplos, de `b2a7fef` a `HEAD` | 259 frases cambian. Unas 200 mejoran (只 81, 片 44, 作 23, 趟 10, 的哥 8, 抢 5…) y unas 60 empeoran (I1) |
| CSP (`index.html:13`) | `script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'` y `connect-src 'self' https: data:` (sobre `data:`, ver M1) |
| Archivos de código > 1000 líneas | Ninguno. El mayor sigue siendo `src/learn/dictation.js`, con 774. `build-examples.mjs` tiene 559 |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| `git status --short` | vacío |

### Mutaciones (código del delta)

| Mutación | Resultado |
|---|---|
| `secrets.js` sin `conversationHistory` en `SECRET_KEYS.settings` | muere |
| `conversation.js` `loadConfig` vuelve a leer `settings` | muere |
| `gamification.js:276` sin `if (today < state.lastDay) state.lastDay = today` | muere |
| `shell-assets.mjs` sin `dialogues` | muere |
| `orderPool` sin la rotación | muere |
| `main.js:142` sin el bucle de `enqueueDelete` | **sobrevive** (M2) |
| `lessons.js:389` `orderBody` sin `orderPool` | **sobrevive** (M2) |
| `tones.js:235` `level: 'tones'` → `'hsk1'` | **sobrevive** (M2) |
| `gamification-wire.js:17` un `notice` por logro | **sobrevive** (M2) |
| `index.html:33` sin `role="status" aria-live="polite"` | **sobrevive** (M2) |
| `home.js:216` y `progress.js:132` sin `pluralKey` | **sobreviven** (M2) |

## Reglas para quien corrige

- Corrige I1 primero. Después, los menores que cuesten 1-5 líneas.
- Las líneas son de `88126eb`. Si se mueven, búscalas con el `grep -n` indicado.
- I1 pide regenerar los ejemplos con `npm run data:examples`. Las fuentes ya están en `data-work/examples/` y en `public/data/dict`, así que no hace falta red. Commitea el diff de `public/data/examples`.
- No edites `docs/REVIEW-*.md`. Al final pasa `npm test`, `node scripts/check-es-data.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

### I1. El arreglo de REVIEW-7 I3/I4 mete errores nuevos de hanzi y de pinyin en los ejemplos
- **Dónde:** `scripts/build-examples.mjs`:
  - `:179-182`: `simplify`, la regla de 著.
  - `:264` y `:281`: la regla de 只.
  - `:334`: las lecturas fijadas.
  - `:481`: el pinyin sale de `c.simp`. Antes salía de `c.text`, el texto original.
  - Además, el test `tests/examples-data.test.mjs:254-266`.
- **Qué pasa (medido en `public/data/examples/shards`):**
  1. **Hanzi incorrectos.** `simplify` cambia 著 por 着 salvo delante de 名/作. Así convierte 土著, 显著 y 昭著 en **土着 (7 frases), 显着 (13) y 昭着 (2)**, con pinyin `tǔ zhe`. Antes del delta había 0.
  2. **只 adverbio leído como clasificador.** La regla «只 detrás de 这/那 → `zhī`» (la propuse en REVIEW-7) también se aplica a 这只是, 那只是 y 这只不过. Las 12 frases que hay salen `Zhè zhī shì…`, y antes estaban bien. Además, el test de `:262` exige `zhī` y fallaría con la frase correcta.
  3. **Se pierde la lectura del tradicional.** Antes, el pinyin salía del texto original: 寧 daba `níng`, 盡 `jìn`, 價 `jià` y 繫 `jì`. Ahora sale del simplificado, y el carácter suelto toma la lectura por defecto del diccionario. Estos casos empeoran:

     | Carácter | Lectura nueva | Frases | Ejemplo |
     |---|---|---|---|
     | 宁 | `zhù` | 4 | 我宁死不降 |
     | 尽 (verbo) | `jǐn` | 8 | 尽了职责, 尽全力 |
     | 价 | `jiè` | 2 | — |
     | 涌 | `chōng` | 2 | — |
     | 广, 柜, 叶 | `yǎn`, `jǔ`, `xié` | — | — |
     | 发 | `fā` | — | 头发, 理发 |
     | 干 | `gān` | — | 干什么 |

     Las fichas **宁** y **尽** del diccionario muestran sus 4 ejemplos con la lectura mal. Lo comprueba `node` sobre los shards: la clave `宁` da 4 de 4 con `zhù`.
- **Por qué importa:**
  - Es la misma clase de error que bloqueaba REVIEW-7 I4 (escritura y polífonos incorrectos), pero esta vez lo introduce el propio arreglo.
  - El alumno copia 显着 como si fuera simplificado y lee 这只是 con el tono mal. Son frases de uso diario.
  - El test protege uno de los errores en lugar de cazarlo.
- **Corrección (5 líneas, probada en una copia):**
  1. En `:181`, conserva 著 también tras 显, 土, 昭, 卓, 原, 巨, 编, 论, 专, 遗 o 拙, y delante de 称:
     ```js
     out += next === '名' || next === '作' || next === '称' || /[显土昭卓原巨编论专遗拙]/.test(text[i - 1] ?? '') ? ch : '着';
     ```
     En `:186`, añade `.replaceAll('显着', '显著')`: 2 frases de Tatoeba ya traen la errata.
  2. Encima de `:264`, define `const adverbZhi = (before, after) => /[这那]/.test(before) && /[是不有能要会]/.test(after);`.
     - En `:264`, añade `&& !adverbZhi(prev, w[1])`.
     - En `:281`, añade `&& !adverbZhi(partPrev, sentence[sentence.indexOf('只', start) + 1] ?? '')`.
     - Detrás de un numeral la regla se mantiene: 一只是雄的 sigue con `zhī`, que es lo correcto.
  3. En `:334`, añade a la lista `['宁','níng'], ['尽','jìn'], ['价','jià'], ['涌','yǒng'], ['广','guǎng'], ['柜','guì'], ['叶','yè']`.
     - **No** fijes 干 ni 系: lo probé. `干→gàn` rompe 干干净净 (28 frases) y `系→jì` rompe 关系 y 联系.
  4. En `tests/examples-data.test.mjs:262`, salta el caso en que el carácter anterior es 这/那 y el siguiente está en `是不有能要会`. Añade un test que exija `zhǐ` en 这只是 y 那只是, y otro que exija que ninguna frase contenga 土着, 显着 ni 昭着.
- **Resultado medido con 1-3 en la copia:** 48 frases cambian respecto a `HEAD`, y las 48 mejoran:
  - 尽 → `jìn`: 14.
  - 这只是/那只是/这只不过 → `zhǐ`: 12.
  - 宁 → `níng`: 5.
  - 涌, 价, 广, 柜 y 叶: 17.

  Quedan 0 frases con 土着, 显着 o 昭着, y 一只是 sigue con `zhī`.
  - No arregla 头发 `fā` ni 干什么 `gān`. Eso depende de la segmentación (M5) y queda como límite aceptado.
- **Cómo comprobar:** tras regenerar, ejecuta los tres comandos. Además, `npm test` debe pasar con el test retocado.
  ```bash
  grep -o '显着\|土着\|昭着' public/data/examples/shards/*.json | wc -l                 # 0
  grep -o '"zh":"[^"]*这只是[^"]*","pinyin":"[^"]*"' public/data/examples/shards/*.json | grep -c 'zhī shì'   # 0
  grep -o '"pinyin":"[^"]*"' public/data/examples/shards/*.json | grep -c 'níng sǐ\|Níng wèi'   # >= 3
  ```

---

## MENORES

### M1. La CSP de producción admite `data:` en `connect-src` solo por un script de comprobación
- **Dónde:** `index.html:13` (`connect-src 'self' https: data:`), commit `88126eb`, y `tests/review7.test.mjs:39-40`, que lo fija.
- **Qué pasa:** el único `fetch('data:…')` está en `scripts/check-strokes-orient.mjs:109` (`bitmapFrom`). La app no lo usa: `grep -rn "data:image/png" src` da vacío.
- **Por qué importa:** es la política de seguridad de producción ajustada a una herramienta de desarrollo, es decir, lógica en la capa equivocada. El riesgo real es bajo, porque `data:` no sirve para sacar datos del dispositivo.
- **Corrección:** en `check-strokes-orient.mjs:109`, cambia la línea por `createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }))`. Después:
  - Quita `data:` de `connect-src`.
  - Cambia `review7.test.mjs:40` por `assert.ok(!connectSrc.includes('data:'))`.
- **Cómo comprobar:** `node scripts/check-strokes-orient.mjs` da «74 checks OK» y `npm test` está en verde.

### M2. Los tests prueban el helper, no el cableado
Seis arreglos del delta sobreviven si se revierten (tabla de mutaciones). Los dos que importan:
- **Lápida del historial.** `main.js:142`: el test I2 (`review7.test.mjs:80-82`) **copia** el orden migrar → `attach` → `enqueueDelete` en lugar de llamar a `main.js`. Si se borra el bucle de `main.js`, el test sigue en verde.
  - Corrección: mueve las 3 líneas a `export async function retireLegacySecrets(storage, sync)` en `src/secrets.js`, que llame a `migrateSecrets` y a `enqueueDelete`. Llámala desde `main.js` y desde el test.
- **Ordenar sin barajar.** `lessons.js:389`: REVIEW-7 I6 pedía un test de DOM falso sobre `orderBody`, y solo se prueba `orderPool`.
  - Corrección: renderiza una lección con un ejercicio `order` (como en los tests de lecciones existentes) y comprueba que el texto de `.pool-row` no es la respuesta.

El resto (`tones` `level`, el `notice` único, `role="status"` y los plurales) se cubre con un test de una línea cada uno, o con un `grep` en un test de humo.
- **Cómo comprobar:** repite las mutaciones de la tabla. Deben morir.

### M3. El examen cuenta como lección HSK para los logros (el mismo fallo que Tonos)
- **Dónde:** `src/learn/exam.js:286-290` envía `chino:lesson_done` con `lessonId: 'exam'` y `level: state.level`. `src/gamification.js:245-246` lo guarda como una lección más de ese nivel.
- **Qué pasa:** 9 lecciones de HSK1 más un examen de HSK1 llegan al `count: 10` de «HSK 1 completo» (`public/data/achievements.json:132`). Es lo mismo que REVIEW-7 M2 corrigió en `tones.js`.
- **Corrección:** en `exam.js:289`, cambia `level: state.level` por `examLevel: state.level`. Fuera de la gamificación nadie lee `detail.level` (`grep -rn "detail.level\|payload.level" src`).
- **Cómo comprobar:** un test en `tests/gamification.test.mjs` que registre `lesson_done` `{ lessonId: 'exam', examLevel: 'hsk1' }` y compruebe que `levels.hsk1` no cambia.

### M4. Accesibilidad: el aviso de logro puede no anunciarse
- **Dónde:** `src/notice.js:12-13`. El texto se escribe y, en el mismo instante, `#app-status` pasa de `hidden` a visible.
- **Qué pasa:** muchos lectores de pantalla no anuncian una región `aria-live` que entra en el árbol de accesibilidad con el contenido ya puesto. El arreglo de REVIEW-7 M3 (`role="status"`) puede quedarse sin efecto.
- **Corrección:** pon `el.hidden = false` antes y escribe el texto en el siguiente frame: `requestAnimationFrame(() => { el.textContent = t(key, params); })`. Otra opción es no ocultar nunca la región y ocultar solo su estilo visual.
- **Siguen abiertos de REVIEW-7 M3:**
  - El calendario sale por filas.
  - La fecha es ISO, sin día de la semana.
  - Los días futuros se leen como «0 eventos».
  - Al elegir la meta se pierde el foco del chip.
  - Las barras no tienen `aria-valuetext`.
- **Cómo comprobar:** con NVDA o VoiceOver, desbloquea un logro y debe oírse.

### M5. `makeSentencePinyin`: la regla de desempate no se ejecuta nunca
- **Dónde:** `scripts/build-examples.mjs:236-243`.
- **Qué pasa:**
  - `forward.join('') === backward.join('')` compara el texto cubierto, no la segmentación. Cuando todos los caracteres están en el diccionario, lo normal, las dos uniones son iguales y siempre gana la segmentación hacia delante. La regla «la de menos palabras y, si empatan, la de hacia atrás» del comentario no se aplica.
    - Probado con las funciones reales: `掉头发` da `[掉头, 发]` frente a `[掉, 头发]`, con `joinEqual true`. Por eso 头发 sale `fā`.
  - El arreglo de 的哥 se hizo con casos especiales duplicados (`:262` y `:379`).
  - La clase de caracteres de numeral está copiada en `:264`, en `:281` y en el test.
  - El parámetro `maxWordLen` (`:232` y `:481`) ya no se usa.
  - El comentario de `:330` («pinyin is generated from the ORIGINAL text») es falso desde `:481`.
- **Corrección:**
  - Borra las ramas muertas y deja `const words = forward.join('') === backward.join('') ? forward : (backward.length <= forward.length ? backward : forward);` con un comentario que diga lo que hace.
  - Quita `maxWordLen` y corrige `:330`.
  - Saca `const MEASURE_BEFORE = /[一二三四五六七八九十百千万两几这那每]/` como constante.
  - **No** cambies la comparación por igualdad de arrays sin medir antes. Lo probé: cambian 627 frases con resultado mixto, por ejemplo 的 `de`→`dī` en 32.
- **Cómo comprobar:** regenerar no cambia ningún shard (`git status --short public/data/examples` vacío).

### M6. I5 de REVIEW-7 no tiene el test de sílabas que se pidió
- **Dónde:** `tests/readings-levels.test.mjs`. `grep -rn "reading-14\|sílaba\|syllab" tests` da vacío.
- **Qué pasa:** los datos están bien, lo confirman t_526312a0 y t_9ddeec48. Pero nada impide que vuelva un 很好玩 sin la sílaba de 好.
- **Corrección:** para cada línea de las lecturas, cuenta los hanzi y las sílabas del pinyin, y exige que coincidan. Para separar las sílabas, cuenta los grupos vocálicos de cada palabra o usa el separador de `pinyinForText`. Ignora la puntuación y añade una lista blanca de excepciones (儿 de la erhua).
- **Cómo comprobar:** cambia `Hěn hǎowán` por `Hěn wán` en `reading-14`: el test debe fallar.

### M7. Abiertos de REVIEW-7 que siguen igual
- **M4 (diálogos):**
  - Los distractores de «Eres B» admiten dos respuestas válidas (`dialogues.js:113-115`).
  - 一 sin sandhi en 6 líneas: d11 l9, d14 l0/l3/l4, d15 l5 y d19 l5.
  - 别放在心里 (d26) y 这几天都很晴 (d27).
  - `shuffle` está duplicado en `dialogues.js:90`.
- **M5 (lecturas):** `Bùguò` en hsk3/04:22, `bù tài` en hsk3/15:29 y `yīxià` en hsk3/10, hsk3/15 y hsk3/17. No hay ninguna nota en `docs/reading-schema.md`.
- **M6 (ejemplos):** el filtro de ancho completo está corregido (`:361`). Sigue sin enlace por frase a Tatoeba, y `CREDITS.md:84` sigue diciendo «carry no author».
- **M7 (mantenibilidad):**
  - Dos contadores diarios: `stats.js` y `gamification`.
  - `pluralKey`, `formatDate` y `dayNumberFromKey` duplicados.
  - CSS inyectado desde `ensureStyles`.
  - `window.__gamification` en producción (`gamification-wire.js:40`).
  - El número mágico `areas.length > 4` en `extras.js:101`.
  - La lápida que borra el historial de un dispositivo con la versión antigua ya es intencionada (I2) y queda aceptada.
- **M9 (otros):**
  - Búsqueda ES: `hermano` y `agua`.
  - puppeteer sin `devDependencies`.
  - `docs/AUDIO.md:149` dice «1 104 clips».
  - `es/lessons/hsk4/lesson-08.json:189` glosa 经历 como «someterse a».
  - `exercises[7]` de HSK4 dice «Which character».
  - `reading-18` lleva `speaker: ""` en 7 líneas.
- **M2 (gamificación):** `levels` sigue sin rellenarse desde `progress`. Era opcional.

---

## Lo que está bien (verificado en esta ronda)

- **CSP (I1):** WebLLM (jsDelivr y wasm) y Ollama sobre https ya no se bloquean, y hay un test que lo fija. No probé WebLLM en vivo porque headless no tiene WebGPU.
- **Historial privado (I2):** está bien en los tres frentes:
  - `SECRET_KEYS.settings` incluye el historial, así que `pull` (`client.js:322`), `push` (`:149`) y el backup (`backup.js:36`, `:114` y `:120`) lo ignoran en `settings`.
  - La lápida sí se sube: `collectLocal` no filtra `state.deleted` por `isSecret` (`:160-164`).
  - La migración vive solo en el arranque.
- **I5:** las 8 filas del cuadro están corregidas en en y en es (`grep` = 0). Los ejercicios Ordenar nuevos (`你猜对了` y `我在写日记`) tienen un solo orden válido, y su enunciado es está traducido.
- **I6:** `orderPool` baraja sin mutar el array original y rota el orden si sale resuelto. El test muere al quitar la rotación.
- **Menores de REVIEW-7 corregidos:**
  - Los diálogos están en el precache (+62 entradas), con la política documentada en `shell-assets.mjs` y un test.
  - El reloj que salta hacia delante ya no congela la racha, con un test que muere al mutar.
  - Tonos ya no cuenta como lección HSK1.
  - `DAILY_CAPS` habla de eventos.
  - Hay plurales `.one/.other` en es/en.
  - Varios logros se anuncian juntos en un solo aviso.
  - El filtro de dígitos de ancho completo está corregido.
- **Ejemplos:** 0 claves falsas (去火, 请安, 会安, 白汤, 的哥) y 0 `dī gē`. Tampoco quedan 於, 乾净 ni variantes japonesas. Unas 200 frases mejoran su pinyin.
- **Higiene:** 0 coautores, `git status` vacío y build reproducible. Ningún archivo pasa de 1000 líneas.

---

## Estado de los hallazgos de `docs/REVIEW-7.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| I1 | La CSP bloquea WebLLM y Ollama | **Corregido de verdad** | `index.html:13` y `review7.test.mjs:21`. Lo de `data:` va aparte (M1) |
| I2 | El historial vuelve a `settings` y se sincroniza | **Corregido de verdad** | Tres mutaciones mueren. Falta probar el cableado de `main.js` (M2) |
| I3 | Segmentación voraz en los ejemplos | **Corregido (selección)** | Quedan 0 claves falsas. La parte del pinyin «usa la de hacia atrás» no se ejecuta (M5) |
| I4 | Polífonos y tradicionales | **Parcial, con regresión** | 只, 片, 作, 趟, 抢, 於 y 乾 bien, pero hay 22 frases con 着 por 著, 12 con 这只是 `zhī` y unas 25 lecturas perdidas del tradicional (I1) |
| I5 | Errores de contenido | **Corregido de verdad** | Datos bien en en y es. Falta el test de sílabas (M6) |
| I6 | Ordenar sale resuelto | **Corregido de verdad** | `orderPool` con test. Falta probar `orderBody` (M2) |
| M1 | Precache y diálogos sin conexión | **Corregido de verdad** | Política documentada y test que muere |
| M2 | Gamificación: lógica de borde | **Casi todo corregido** | Tonos, reloj y comentario bien. Queda el mismo fallo en el examen (M3) y `levels` (opcional) |
| M3 | Accesibilidad de la motivación | **Parcial** | `role="status"`, un solo aviso y plurales bien. Quedan el anuncio (M4), el calendario, el foco y `aria-valuetext` |
| M4 | Diálogos: distractores y sandhi | **Abierto** | M7 |
| M5 | Lecturas: sandhi | **Abierto** | M7 |
| M6 | Ejemplos: atribución y filtros | **Parcial** | Filtro de ancho completo bien. Faltan el enlace y `CREDITS` |
| M7 | Mantenibilidad del delta | **Abierto** | El punto de la lápida queda aceptado por diseño (I2) |
| M8 | Tests débiles en gamificación | **Parcial** | Test del reloj añadido. Siguen los 4 que faltaban, y salen 6 supervivientes nuevos (M2) |
| M9 | Abiertos anteriores y documentación | **Abierto** | M7 |

Resumen de la tabla (15): 6 corregidos de verdad, 1 corregido en parte, 5 parciales (uno con regresión) y 3 abiertos. Todos los importantes de REVIEW-7 salvo I4 están cerrados.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** 1 (I1).
- **Menores:** 7 (M1-M7).
- **Veredicto:** NO APROBADO para publicar.
- **Los 3 más importantes:**
  1. **I1:** el arreglo de los ejemplos escribe 显着, 土着 y 昭着 (22 frases) y lee 这只是 con `zhī` (12). Además, pierde las lecturas que daba el tradicional: las fichas de 宁 y 尽 tienen sus 4 ejemplos mal. Bastan 5 líneas en `build-examples.mjs`, ya probadas, más regenerar y corregir el test de `:262`.
  2. **M2:** dos arreglos clave (la lápida del historial en `main.js` y el barajado en `orderBody`) se pueden revertir sin que falle ningún test. Mover la orquestación a `retireLegacySecrets` y probar `orderBody` lo cierra.
  3. **M3:** el examen cuenta como lección HSK y adelanta el logro «HSK 1 completo». Es el mismo fallo que se corrigió en Tonos, y se arregla con `examLevel` en `exam.js:289`.
