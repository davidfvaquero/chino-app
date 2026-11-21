# Revisión de calidad thermo-nuclear, ronda 7 (delta): chino-app

- **Base revisada:** `HEAD` = `87f663a`. El delta va desde el informe anterior (`92999a9`, REVIEW-6) hasta `HEAD`: 92 commits y 615 archivos. De ellos, 81 son código, tests y documentación, y 534 son datos y audio.
  - `git log -1 --format=%H -- docs/REVIEW-6.md` devuelve `92999a9`.
- **Ámbito:** los menores de REVIEW-6, HSK4 (20 lecciones en/es), las lecturas HSK2/HSK3, los diálogos con audio a 2 voces, los ejemplos de Tatoeba en el diccionario y la motivación (racha, meta, logros, calendario).
  - El delta toca seguridad (CSP en `index.html`), datos (secretos, migración del historial) y sync, así que esas zonas se revisaron enteras.
- **Revisor:** opus (tarea t_e57d9dee). Solo lectura. El único archivo nuevo es este informe.
- **Método:**
  - Copia limpia con `git archive HEAD`: `npm test`, `check-i18n`, `check-es-data`, `validate-dict-es` y el build.
  - Build de `92999a9` y de `HEAD` para comparar el precache.
  - Sondas con los datos reales: búsqueda ES (13 consultas), sync y backup con un servidor falso, y gamificación con los módulos reales.
  - Scripts sobre todo el corpus nuevo: alineación sílaba/hanzi, sandhi de 一/不, nivel HSK, ejercicios, segmentación y polífonos de los ejemplos, caracteres tradicionales y audio.
  - Muestreo aleatorio con semilla: 15 elementos de lecciones, 15 de lecturas, 15 de diálogos y 15 de ejemplos.
  - 17 mutaciones (16 de gamificación y migración, y 1 de REVIEW-6 M1).
  - Las tareas madre t_ab88cc41 (mecánico de ejemplos) y t_3d8c6315 (motivación, visual) pasaron `check-contrast` y `check-layout` en `f80370b`. En esta ronda no los repetí.

## Veredicto: **NO APROBADO para publicar**

**Sin críticos. 6 importantes y 9 menores.**

- **Regresión de seguridad/funcionalidad:** la CSP nueva (arreglo de REVIEW-6 M4) bloquea la IA en el navegador (WebLLM) y Ollama. Solo funciona OpenRouter (I1).
- **Privacidad:** el historial de conversación pasó a `meta`, pero el primer `pull` lo resucita en `settings` y lo vuelve a subir. Un backup antiguo también lo mete en `settings` (I2).
- **Contenido:**
  - Los ejemplos del diccionario tienen errores sistemáticos de segmentación, de polífonos y de caracteres tradicionales (I3 e I4).
  - Hay errores concretos que aprendería un alumno en lecturas, lecciones y diálogos (I5).
  - Uno de cada cinco ejercicios «Ordenar» de HSK2 a HSK4 sale ya resuelto (I6).
- Lo bueno: tests y build en verde, ejemplos y audio fuera del precache, licencias de Kokoro y Tatoeba presentes y REVIEW-6 M1-M2 corregidos de verdad. Detalle al final.

## Estado medido

| Comprobación | Resultado |
|---|---|
| `npm test` (copia limpia) | 1315/1315 en verde (3,9 s) |
| `check-i18n` | OK, 1064 claves, todas traducidas |
| `check-es-data` | 209 archivos, 0 errores |
| `validate-dict-es` | 0 errores (los mismos 762 avisos) |
| Build | OK, 2537 archivos. `DATA_CACHE` sin cambios (`002ad218a559`), correcto porque no cambia ningún dato cache-first |
| Precache del SW | Pasa de 327 entradas y 1,77 MB a **456 entradas y 2,37 MB** (+129, +590 KB, unos 117 KB con gzip). Lo nuevo son las lecciones HSK4 y las lecturas HSK2/3, en en y en es (M1) |
| Ejemplos | 7,7 MB, 64 shards, 38 336 frases y 13 446 palabras. Fuera del precache y por stale-while-revalidate, así que una corrección llega al usuario |
| Audio | 8,5 MB, 1381 mp3, fuera del precache. Todas las líneas de diálogo tienen archivo y no hay huérfanos |
| CSP | `index.html:10`: `script-src 'self'` y `connect-src 'self' https://openrouter.ai https://*.supabase.co` (I1) |
| Archivos de código > 1000 líneas | Ninguno (el mayor es `src/learn/dictation.js`, con 774) |
| `innerHTML`/`html:` nuevos | 3, todos con `pinyinHtml`, que escapa |
| `git log --format=%B \| grep -ic co-authored` | 0 |
| `git status --short` | vacío |

### Mutaciones

| Mutación | Resultado |
|---|---|
| `conversation.js:501` `if (lastDay !== day)` → `if (true)` (REVIEW-6 M1) | **muere** |
| `gamification.js:185` `weekStartNumber(today-1)` → `(today)` | sobrevive |
| `gamification.js:261` `weekStartNumber(missing)` → `(today)` | sobrevive |
| `gamification.js:245` sin `&& payload?.lessonId` | sobrevive |
| `gamification.js:242` `dayPoints` sin tope | sobrevive |
| `gamification-wire.js:25` sin `announceUnlocked` | sobrevive |
| `secrets.js:24` sobrescribe `meta` aunque ya exista | sobrevive |
| `conversation.js:130` `value = legacy` siempre | sobrevive |
| `home.js:174` `if (true)` en el aviso de racha en riesgo | sobrevive |
| Otras 8 (tope diario, `streakAtRisk`, reloj hacia atrás, inicio de semana en `day.js`, futuro en el calendario, `freezeStatus`, secreto en el backup, estado de la ficha de logro) | mueren |

## Reglas para quien corrige

- Corrige I1-I6 en orden. Después, los menores que cuesten 1-5 líneas.
- Las líneas son de `87f663a`. Si se mueven, búscalas con el `grep -n` indicado.
- **I3 e I4 piden regenerar los ejemplos** con `npm run data:examples`. Las fuentes ya están en `.cache/` (`cmn_sentences.tsv.bz2`, enlaces y `cedict.txt.gz`), así que no hace falta red. Commitea el diff de `public/data/examples`.
- I5 son cambios de datos: corrige **siempre en `public/data/...` y en `public/data/es/...`**. Los dos llevan el mismo hanzi y el mismo pinyin.
- No edites `docs/REVIEW-*.md`. Al final pasa `npm test`, `node scripts/check-es-data.mjs`, `node scripts/validate-dict-es.mjs` y `OUT_DIR=/tmp/chino-fix node scripts/build.mjs`.

---

## CRÍTICOS

Sin críticos.

---

## IMPORTANTES

### I1. La CSP nueva bloquea WebLLM y Ollama (regresión del arreglo de REVIEW-6 M4)
- **Dónde:** `index.html:10` (`grep -n Content-Security-Policy index.html`).
- **Qué pasa:**
  - `script-src 'self'` bloquea el `import()` de `WEBLLM_CDN_URL` (`https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@…/+esm`, `src/chat/webllm-provider.js:34`).
  - Falta `'wasm-unsafe-eval'`, que WebLLM necesita para compilar su WebAssembly.
  - `connect-src` no permite descargar los pesos (`huggingface.co`, y la librería del modelo en `raw.githubusercontent.com`).
  - `connect-src` tampoco permite la URL de Ollama, que es libre (`src/chat/providers.js:140`; el campo sugiere `https://my-host.ts.net`).
  - Ningún test mira la CSP (`grep -rl connect-src tests` da vacío).
- **Por qué importa:** dos de los tres proveedores de conversación dejan de funcionar en producción, y los tests siguen en verde. `CREDITS.md:163` sigue anunciando WebLLM desde jsDelivr.
- **Corrección:** en la meta de `index.html:10`, cambia `script-src 'self'` por `script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'` y `connect-src …` por `connect-src 'self' https:`. Ollama apunta a un host cualquiera, y la app ya exige https para él. Añade un test que lea `index.html` y compruebe que `script-src` contiene el origen de `WEBLLM_CDN_URL` y que `connect-src` contiene `https:`.
- **Cómo comprobar:** `npm test` con el test nuevo. En Chrome, sirve `dist/`, elige «En el navegador» y pulsa «Descargar»: la consola no debe mostrar `Refused to load` ni `Refused to connect`. Con Ollama apuntando a una URL https, la petición debe salir (aunque falle por red).

### I2. El historial de conversación sigue sincronizándose (REVIEW-6 M4, parte del historial, a medias)
- **Dónde:** `src/secrets.js:7-10` (`SECRET_KEYS`), `src/main.js:135-139`, `src/sync/client.js:322` y `src/backup.js:111-120`.
- **Qué pasa (probado con un servidor falso y los módulos reales):**
  - `migrateSecrets` mueve `settings/conversationHistory` a `meta` **antes** de `sync.attach()`, así que no se crea lápida. La fila del servidor sigue viva.
  - `SECRET_KEYS.settings` solo contiene `openrouterKey`, así que `pull` acepta la fila remota `settings/conversationHistory`. Resultado del primer `syncNow` tras actualizar: `{pulled:1, pushed:1}`, el historial vuelve a `settings` y se sube otra vez.
  - Así sigue hasta que el usuario abre Conversación, porque `loadConfig` (`src/extras/conversation.js:126-137`) repite la migración con sync enganchado.
  - Al importar un backup antiguo, `stores.settings.conversationHistory` se escribe en `settings`. El siguiente `push` lo sube (`push after import includes history: true`).
- **Por qué importa:** el commit `e4df882` promete que el chat privado no sale del dispositivo, y sigue en Supabase y en los backups exportados.
- **Corrección (3 cambios pequeños):**
  1. Añade `'conversationHistory'` a `SECRET_KEYS.settings` en `src/secrets.js:9`. Con eso, `push`, `pull`, el export y el import lo ignoran en `settings`, igual que `openrouterKey`.
  2. Haz que `migrateSecrets` devuelva las claves que movió. En `main.js`, después de `sync.attach()`, llama a `sync.enqueueDelete('settings', key)` por cada una, para que la fila del servidor quede borrada.
  3. Quita la migración duplicada de `loadConfig` (lee `meta` directamente). Así queda una sola migración, en la capa de arranque.
- **Cómo comprobar:** un test en `tests/sync-client.test.mjs` con este escenario:
  1. Dispositivo antiguo con el historial en `settings`, sincronizado.
  2. Reinicio con `createStorage` sobre el mismo driver, `migrateSecrets`, `attach` y `syncNow`.
  3. Se espera que `settings/conversationHistory` local quede `undefined`, que la fila del servidor quede `deleted` y que `meta` conserve el historial.

  Un segundo test: importar `{stores:{settings:{conversationHistory:[…]}}}` no escribe en `settings`.

### I3. Ejemplos del diccionario: la segmentación voraz asigna frases a palabras que no están y estropea el pinyin
- **Dónde:** `scripts/build-examples.mjs:133` (`segment`, longest-match hacia delante) y `:191` (`makeSentencePinyin`, la misma estrategia).
- **Qué pasa (medido en `public/data/examples/shards`):**
  - 去火 → «他该去火车站了», 请安 → «请安静点», 会安 → «我会安排一下», 白汤 → «我不明白汤姆…», 名医 → «一名医生», 有电 → «你有电视吗», 没准 → «我没准备», 过多 → «你阅读过多少书».
  - El pinyin también falla: las **24** frases con 我的哥哥 salen como `wǒ dī gē gē`, porque gana 的哥 («taxista»). `grep -o 'dī gē' public/data/examples/shards/*.json | wc -l` da 24.
  - Una segmentación por programación dinámica marca 2197 ejemplos dudosos. En una muestra de 60, el 72 % son errores reales: unos 1500 ejemplos (≈4 %) en unas 900 palabras.
  - t_ab88cc41 ya avisó de 会安 y de 朗, y no se reparó.
- **Por qué importa:** la tarjeta resalta en negrita una «palabra» que la frase no contiene, y el alumno aprende `dī` para 的. La limitación aceptada es solo la de 了.
- **Corrección:** añade `segmentBackward(text, wordSet)`, la misma función recorriendo desde el final. La máxima coincidencia hacia atrás acierta en todos los casos de arriba.
  - En la selección de ejemplos (bucle de `:302`, `for (const w of segment(simp, wordSet))`), acepta `w` solo si también aparece en `segmentBackward(simp, wordSet)`.
  - En `makeSentencePinyin`, cuando las dos segmentaciones difieran, usa la de hacia atrás.
  - Regenera con `npm run data:examples`.
- **Cómo comprobar:** tras regenerar, `grep -c '"去火"\|"请安"\|"会安"\|"白汤"\|"的哥"' public/data/examples/shards/*.json` suma 0 y `grep -o 'dī gē' … | wc -l` da 0. Añade a `tests/examples-data.test.mjs` un caso con estas 5 claves ausentes y otro que diga que ninguna frase con 的哥哥 lleva `dī`.

### I4. Ejemplos del diccionario: polífonos sin contexto y caracteres tradicionales en el texto «simplificado»
- **Dónde:** `scripts/build-examples.mjs:248-266` (`scoreOf`/`consider`: una lectura por palabra) y `:298` (`toSimplified`).
- **Qué pasa:**
  - Los caracteres sueltos llevan siempre la misma lectura. Ejemplos: 这只橙子 → `zhè zhǐ` (68 frases con numeral o demostrativo + 只 leído `zhǐ`), 一片狼藉 → `yī piān`, 之作 → `zuō`, 这趟火车 → `tāng`, 抢银行 → `qiāng`, 我得买 → `de`, 有没有空 → `kōng`. Son unas 300 frases.
  - El comentario `ponytail:` de `:154` reconoce el techo, pero los casos de 只, 片, 作, 趟 y 抢 no dependen de contexto: es una lectura por defecto mal elegida.
  - Quedan caracteres tradicionales: **於 en 296 frases** (等於, 关於), 乾 en 52 (乾净), 著 como partícula (忙著, 背著) y variantes japonesas (髪, 顔, 犠, 兿, 貭).
- **Por qué importa:** es pinyin y escritura incorrectos en frases de uso diario que el alumno puede escuchar y copiar.
- **Corrección (ponytail, sin librería):**
  1. Después de `consider`, fija estas lecturas por defecto: `wordPinyin.set('片','piàn')`, `('作','zuò')`, `('趟','tàng')`, `('抢','qiǎng')`.
  2. En `makeSentencePinyin`, añade una regla: 只 detrás de 一-十, 两, 几, 这, 那 o 每 se lee `zhī`. Lo mismo para 空 detrás de 有/没 (`kòng`) y 得 delante de un verbo tras 就/还/也 (`děi`). Esta última es opcional.
  3. Antes de `toSimplified`, aplica el mapa `{於:'于', 乾:'干', 髪:'发', 顔:'颜', 犠:'牺', 兿:'艺'}` (salvo en 乾隆/乾坤) y `著` → `着` cuando no va seguido de 名/作. Descarta las frases con 貭.
- **Cómo comprobar:** tras regenerar, `grep -c '於\|乾净' public/data/examples/shards/*.json` suma 0. Ninguna frase con `/[一两几这那每]只/` lleva `zhǐ` justo después de la sílaba del numeral. Añade los dos casos a `tests/examples-data.test.mjs`.

### I5. Errores de contenido que aprendería un alumno (lecturas, lecciones y diálogos)
Cada fila es un cambio de una línea en en **y** en es (mismo número de línea en los dos árboles):

| Archivo (`public/data/…` y `public/data/es/…`) | Línea | Qué falla | Cambio exacto |
|---|---|---|---|
| `readings/hsk2/reading-14.json` | 16 | 很好玩 sin la sílaba de 好 (9 hanzi, 8 sílabas) | `"Qù guo, qùnián qù de. Hěn hǎowán."` |
| `readings/hsk3/reading-12.json` y `readings/hsk1/reading-16.json` | `grep -n Wèishéme` | 为什么 escrito `Wèishéme` | `Wèishénme` |
| `readings/hsk3/reading-07.json`, `-11`, `-12`, `-17` | `grep -n xīngqí` (10 apariciones por árbol) | 星期 con la lectura de Taiwán; el resto de la app usa `xīngqī` | `xīngqí` → `xīngqī` |
| `lessons/hsk4/lesson-19.json` | 211-213 | El ejemplo de 之 es 之子于归, una cita del Shijing mal traducida | `{"hanzi":"百分之五十","pinyin":"bǎi fēn zhī wǔshí","english":"fifty percent"}` (es: «cincuenta por ciento») |
| `lessons/hsk4/lesson-17.json` | 345-349 (`exercises[3]`, listen) | 钥匙 y 要是 suenan igual (`yàoshi`): dos respuestas correctas | Cambia la opción `"要是"` por `"压力"` |
| `lessons/hsk4/lesson-13.json` | 39 (`exercises[1]`) | «life» / «vida»: 生活 también es correcto | Cambia la opción `"生活"` por `"失败"` |
| `dialogues/dialogue-15.json` | 34-36 | 太长了吧。有大一点儿的吗？ no tiene lógica, y en/es dicen «a bit long» | zh `太小了吧。有大一点儿的吗？`, pinyin `Tài xiǎo le ba. Yǒu dà yìdiǎnr de ma?`, en `It's too small. Do you have a bigger one?`, es `Es demasiado pequeña. ¿Tiene una más grande?` |
| `dialogues/dialogue-14.json` | 46-52 | Roles invertidos: el cliente (A) pregunta 还要别的吗？ y el cajero (B) contesta | Intercambia el texto de las líneas 6 y 7 (zh, pinyin, en/es) y deja los `speaker`. A queda como `不要了，谢谢。` |

- **Por qué importa:** son errores que el alumno memoriza: una sílaba que falta, pinyin mal escrito, un ejercicio que da por mala una respuesta correcta y un diálogo sin sentido en el modo «Eres B».
- **Cómo comprobar:** `grep -rc 'Wèishéme\|xīngqí\|之子于归\|太长了吧' public/data` da 0 en todos los archivos. Añade a `tests/readings-levels.test.mjs` un test que cuente las sílabas del pinyin frente a los hanzi de cada línea, ignorando la puntuación y las excepciones de doble lectura ya conocidas. Habría cazado reading-14.

### I6. Los ejercicios «Ordenar» salen resueltos: `orderBody` no baraja
- **Dónde:** `src/learn/lessons.js:378` (`const pool = … [...exercise.tokens]`).
- **Qué pasa:** el pool se muestra en el orden del JSON, y muchos JSON traen los tokens ya en el orden de la respuesta.
  - Medido: HSK2 11 de 20, HSK3 2 de 20 y **HSK4 12 de 40** (por ejemplo `["我","支","持","你"]` → `我支持你`). HSK1, 0 de 16.
  - Además, `lesson-02` ex. 5 (在北京出生 / 出生在北京) y `lesson-12` ex. 5 (我每天 / 每天我) admiten otro orden válido, y la app lo da por malo.
- **Por qué importa:** uno de cada cinco ejercicios no ejercita nada, y el alumno lo aprueba sin pensar.
- **Corrección (ponytail):** baraja en el componente, no en los datos.
  ```js
  import { shuffle } from '../random.js';
  // :378
  let pool = Array.isArray(exercise.tokens) ? shuffle([...exercise.tokens]) : [];
  if (pool.length > 1 && pool.join('') === exercise.answer) pool.push(pool.shift());
  ```
  Si la regla de `const` molesta, usa `pool.splice(0, pool.length, ...)`. Para los dos de orden doble, cambia la frase por una de orden único.
- **Cómo comprobar:** un test de DOM falso que renderiza `lesson-19` ex. 6 y comprueba que el texto del `pool-row` no es `我支持你`. Revertir la línea debe hacerlo fallar.

---

## MENORES

### M1. El precache crece un 34 % y los diálogos no funcionan sin conexión en una visita en frío
- **Dónde:** `scripts/lib/shell-assets.mjs:11` (`SHELL_ASSET_RE`).
- **Qué pasa:**
  - La regla precachea todas las lecciones y lecturas en los dos idiomas: +129 entradas y +590 KB (unos 117 KB con gzip). En total, 2,37 MB.
  - `data/dialogues` no está en la regla. Sin conexión y sin visita previa, «Diálogos» muestra `dialogues.loadError`, mientras que Lecciones y Lecturas sí funcionan.
  - Lo pesado de verdad (ejemplos, 7,7 MB, y audio, 8,5 MB) sí queda fuera, como pedía la tarea.
- **Corrección:** decide una política y anótala en el comentario de `shell-assets.mjs`.
  - Para cumplir «no crecer», precachea solo `index.json` de cada nivel y deja los cuerpos en la caché en tiempo de ejecución.
  - Para cumplir «sin conexión», añade `dialogues` a la regla (`(readings|themes|grammar|plan|dialogues)`, unos 256 KB en/es).
- **Cómo comprobar:** `tests/` ya fija `isShellAsset`. Añade el caso `data/dialogues/index.json` con la política elegida.

### M2. Gamificación: lógica de borde
- `src/learn/tones.js:235`: la lección de tonos envía `level:'hsk1'`, y cuenta como lección HSK1. Con 9 lecciones reales más Tonos se desbloquea «HSK 1 completo» (probado). Corrección: `level: 'tones'`.
- `src/gamification.js:274`: si el reloj salta hacia delante y vuelve, `lastDay` queda en el futuro y la racha no sube durante semanas (probado: 10 días reales dejan `streak=1`). Corrección: en la rama `today < lastDay`, haz `state.lastDay = today` sin tocar la racha.
- `:235-236`: `DAILY_CAPS` compara número de eventos, pero el comentario dice puntos. Hoy coincide porque `example_played` vale 1. Corrección: renombra el comentario a «eventos».
- Migración: el estado antiguo carga sin perder puntos, racha ni días (probado). Pero `levels` empieza vacío: las lecciones ya hechas no cuentan para los logros HSK, y el primer evento desbloquea 6 logros a la vez. Corrección opcional: rellena `levels` una vez desde `progress` (`completed:true`).

### M3. Accesibilidad de la motivación
- `index.html:30`: `#app-status` no tiene `role="status"` ni `aria-live="polite"`, así que el aviso de logro no se anuncia. `gamification-wire.js:17` llama a `notice` en bucle, y con varios logros solo se ve el último. Corrección: añade los dos atributos y haz un solo `notice` con los nombres unidos por `, `.
- `src/extras/progress.js:125-133`:
  - El calendario sale en orden de filas (todos los lunes, luego los martes…), no cronológico.
  - La etiqueta es `YYYY-MM-DD: N eventos`: fecha ISO, sin día de la semana y sin «hoy».
  - Los días futuros se leen como «0 eventos».
  
  Corrección: recorre por columnas (`rows[0].map((_, c) => rows.map(r => r[c])).flat()` con `grid-auto-flow: column` en el CSS), formatea la fecha con `Intl.DateTimeFormat(lang, { weekday:'long', day:'numeric', month:'long' })` y pon `aria-hidden` en los días futuros.
- Plurales: `progress.calendar.day`, `progress.calendar.group` y `home.level.toNext` dicen «1 eventos» y «Faltan 1 puntos». Corrección: pásalos a `.one/.other`.
- `src/screens/home.js:255-257`: al elegir la meta se re-renderiza y se pierde el foco del chip. Las barras no tienen `aria-valuetext`.

### M4. Diálogos: distractores equivalentes y pinyin incoherente
- `src/learn/dialogues.js:113-115`: en «Eres B», los distractores salen de cualquier otra línea, incluidas otras despedidas. Unos 8 turnos tienen dos respuestas válidas (`明天见！` frente a `好，明天见！`, `再见！` frente a `谢谢！再见！`). Corrección: excluye `index-1` y las líneas que, quitando `好，`/`谢谢！` y la puntuación, sean iguales o contengan las dos `见`.
- 一 sin sandhi en 6 líneas, aunque el resto de diálogos lo aplica. Cambios: d11 l9 `yíyàng`; d14 l0 `yìqiān`, l3 `yíxià`, l4 `yìbǎi`; d15 l5 `yíxià`; d19 l5 `yíxià`.
- Detalles de naturalidad:
  - d26 l5 `别放在心里` → `别放在心上`.
  - d25 l7 `票` → `小票`.
  - d27 l4 `这几天都很晴` → `这几天都是晴天`.
  - d04: B pide té y luego lo rechaza.
- `src/learn/dialogues.js:90` duplica `shuffle` de `src/random.js:8`. Corrección: impórtalo.

### M5. Lecturas: convención de sandhi
- 一 va casi siempre sin sandhi desde HSK1 (hsk1 54/5, hsk2 32/4, hsk3 33/3). En cambio, 不 sí lleva sandhi desde `c168662`, y lecciones y diálogos lo marcan. Además, 一下 aparece como `yíxià` en hsk2/04 y hsk2/06, y como `yīxià` en hsk3/10, hsk3/15 y hsk3/17.
- 不过 `bùguò` en hsk3/04:22 y hsk3/15:49, y 不太 `bù tài` en hsk3/15:29 (en+es). Se escaparon a `c168662`.
- Corrección: unifica 一下 → `yíxià` y los tres 不 → `bú`. Aplicar el sandhi de 一 en todo es opcional, pero anota la convención en `docs/reading-schema.md`.

### M6. Ejemplos: atribución y filtros
- `src/screens/dictionary.js` muestra «Tatoeba (CC BY 2.0 FR)» y el enlace a CREDITS. Es la misma práctica que las frases ya aprobadas, pero el `id` se guarda y no se enlaza. Corrección barata: enlaza cada frase a `https://tatoeba.org/sentences/show/<id>`.
- `CREDITS.md:83`: la frase «carry no author» vale para las exportaciones por idioma. Precisa que `sentences_detailed` sí trae el usuario, y que se opta por el enlace al id.
- El filtro `/[A-Za-z0-9]/` (`build-examples.mjs:291`) no detecta los dígitos de ancho completo (`１、３、５都是奇数`). Corrección: `/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/`.

### M7. Mantenibilidad del delta
- Dos fuentes de verdad para los contadores diarios: `src/stats.js:35-41`, que alimenta la meta de Home, y `gamification.dayEvents`/`dayPoints`, que alimenta el resumen semanal. `stats.js` no cuenta `dialogue_done` ni `example_played`, así que la meta y el resumen pueden discrepar. Corrección: saca una de las dos de la otra.
- Helpers duplicados:
  - `formatDate` en `achievements.js:63-66` duplica `localDayKey` de `day.js`.
  - `pluralKey` está copiado en `home.js:53` y en `progress.js:22`.
  - `dayNumberFromKey` (`progress.js:37`) debería vivir en `day.js`.
  - `DAILY_GOAL_OPTIONS` (`home.js`) copia `ALLOWED.dailyGoal` de `settings.js`.
  - Hay un `100` fijo en lugar de `POINTS_PER_LEVEL`.
- CSS inyectado desde JS (`ensureStyles` en `progress.js:84-108` y en `achievements.js:40-61`). Su sitio es `styles.css`.
- `gamification-wire.js:37` expone `window.__gamification` en producción («for headless testing»), y `:6-7` importa el mismo módulo dos veces.
- `src/screens/extras.js:101`: el número mágico `areas.length > 4` pliega el grupo «Cuenta» (ahora con 6), y Progreso y Logros quedan tras un `<details>`. Corrección: añade `folded: true` explícito en `GROUPS`.
- El tombstone que genera la migración de `conversation.js` borra el historial de un dispositivo con la versión antigua. Se resuelve con el punto 3 de I2.

### M8. Tests débiles en gamificación y migración
8 de 16 mutaciones sobreviven (ver la tabla). Faltan 4 tests:
- La congelación en el cambio de semana: falta día el domingo y se estudia el lunes.
- Que una lección sin `lessonId` no cuente.
- Que `announceUnlocked` llame a `notice`.
- Que `migrateSecrets` no pise un `meta` ya existente.

### M9. Abiertos de rondas anteriores y documentación
- **Búsqueda ES (REVIEW-6 M3), a medias:** `café` → 咖啡, `zhong` → 中 (3.º), `hao` → 好, `water` → 水 y `hello` → 喂 你好 ya salen bien. Siguen mal `hermano` (大 el primero) y `agua` (5 resultados). `dog` y `water` cuestan 15-18 peticiones y 2,2 MB.
- `scripts/check-exercises.mjs:40`: ruta absoluta de Chrome (ahora detrás de `CHROME_BIN`). Sigue sin `devDependencies` para puppeteer.
- `docs/AUDIO.md:149` dice «1 104 clips» y son 1381.
- HSK4:
  - `es/lessons/hsk4/lesson-08.json:189` glosa 经历 como «someterse a». Debe ser «pasar por; vivir (una experiencia)».
  - `exercises[7]` de las lecciones 01-15 dice «Which character means…» cuando la respuesta es una palabra de dos caracteres.
  - 民族 y 国籍 se glosan los dos como «nationality».
- `readings/hsk2/reading-18.json`: `speaker: ""` en las 7 líneas de un texto. Quita la clave.
- Quedan 43 referencias `REVIEW-N` en `src`, `sw.js` y `scripts`, sin cambios.

---

## Lo que está bien (verificado en esta ronda)

- **Tests y build:** 1315 en verde, i18n completo y build reproducible. `DATA_CACHE` no rota sin motivo.
- **Precache:** los ejemplos (7,7 MB) y el audio (8,5 MB) quedan fuera. Los ejemplos usan stale-while-revalidate, así que una regeneración de I3/I4 llega a quien ya los tenía.
- **Licencias:** Kokoro-82M v1.1-zh (Apache-2.0) con las dos voces nombradas en `CREDITS.md` §8. Tatoeba CC BY 2.0 FR para los ejemplos en `CREDITS.md:77-85`, y el `id` de cada frase se conserva.
- **Audio:** cada línea de diálogo tiene su mp3 en disco, sin huérfanos ni claves sin uso. La alternancia A/B es estricta en los 30 diálogos.
- **HSK4:**
  - Están las 598 palabras, sin duplicados y con el pinyin igual a la lista.
  - Los árboles es y en tienen hanzi y pinyin idénticos.
  - Todas las respuestas `choose`/`listen` están entre las opciones.
  - Muestra: 13 de 15 entradas bien (fallan 之 y la glosa es de 经历).
- **Lecturas HSK2/3:** solo usan caracteres de su nivel acumulado, y es y en están completos. Muestra: 10 de 15 bien sin contar el sandhi de 一 (fallos: I5 y M5).
- **Diálogos:** muestra de 15 líneas, 15 bien. Los fallos de I5/M4 salieron en el barrido completo.
- **Ejemplos:** muestra de 15 entradas, 15 bien dentro de la convención del corpus. Los fallos de I3/I4 salieron en el barrido completo (≈4 % y ≈1 %). Las mayúsculas a mitad de frase de t_ab88cc41 están corregidas (0).
- **Migración de gamificación:** el estado de `92999a9` carga con puntos, racha, días y logros. La racha con congelación (F1 de t_3d8c6315) y el texto de nivel (F2) están corregidos, con tests que mueren al mutar.
- **Sync:** la gamificación solo añade campos al blob `state`, que ya se sincronizaba. Nada nuevo sale del dispositivo, salvo lo de I2.
- **Seguridad:** sin `innerHTML` nuevo fuera de `pinyinHtml`, y `SECRET_KEYS` sigue filtrando `openrouterKey` en `push`, `pull` y backup.
- **Higiene:** 0 coautores, `git status` vacío y scripts de muestreo movidos a `scripts/tools/` con README. `VERIFICATION.md` baja a 78 líneas y el histórico va a `docs/verification-archive.md`.

---

## Estado de los hallazgos de `docs/REVIEW-6.md`

| # | Hallazgo | Estado | Evidencia / qué falta |
|---|---|---|---|
| M1 | Test del premio diario vacío | **Corregido de verdad** | `review3-critical.test.mjs:526` pulsa el `button`. La mutación `if (true)` en `conversation.js:501` mata «the daily conversation reward fires once» |
| M2 | CI con `git diff` y sin `build-data` | **Corregido de verdad** | `pages.yml` usa `git status --porcelain public/data`. `README.md:30` documenta correr `npm run data` tras tocar `build-data.mjs` |
| M3 | Búsqueda ES: rutas y orden | **Parcial** | `café`, `zhong`, `hao`, `water` y `hello` ya bien. Quedan `hermano`, `agua` y el peso de `dog`/`water` (M9) |
| M4a | Sin CSP | **Parcial (con regresión)** | CSP añadida, pero rompe WebLLM y Ollama (I1) |
| M4b | Enlace a CREDITS en Ajustes | **Corregido de verdad** | `settings.js:194` |
| M4c | Install con precache incompleto | **Corregido de verdad** | Reintento y fallo del install si falta un esencial (`sw.js:28-36`) |
| M4d | Scripts de muestreo en git | **Corregido** | Movidos a `scripts/tools/` con README. Siguen en git, pero documentados |
| M4e | `lang` y reduced-motion en la hoja de trazos | **Corregido de verdad** | `zhRuns` en etimología y significado, y `reduced: prefersReducedMotion()` |
| M4f | Documentación (`works offline`, `VERIFICATION.md`) | **Corregido de verdad** | 78 líneas más el archivo histórico |
| M4g | Ruta de Chrome y puppeteer | **Abierto** | Ver M9 |
| M4h | Opener en inglés | **Corregido de verdad** | `prompts.js` traduce con `t('conversation.opener.*')` |
| M4i | Inglés en locale es (`hello`, `water`) | **Corregido de verdad** | `hello` → 喂 你好 y `water` → 水 |
| M4j | Historial de conversación en `settings` sincronizado | **Parcial** | Se mueve a `meta`, pero el `pull` y el import de backup lo devuelven a `settings` (I2) |
| M4k | `saveProgress` duplicado | **Corregido de verdad** | `saveProgressSafe` en `lessons.js:166`, y `tones.js` lo reutiliza |

Resumen de la tabla (14): 10 corregidos (9 de verdad), 3 parciales (uno con regresión) y 1 abierto.

---

## Resumen

- **Críticos:** sin críticos.
- **Importantes:** 6 (I1-I6).
- **Menores:** 9 (M1-M9).
- **Veredicto:** NO APROBADO para publicar.
- **Los 3 más importantes:**
  1. **I1:** la CSP nueva bloquea WebLLM (jsDelivr, WebAssembly y Hugging Face) y Ollama. Basta con `script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'`, `connect-src 'self' https:` y un test que lo fije.
  2. **I2:** el historial «privado» vuelve a `settings` con el primer `pull` y con un backup antiguo, y se sube a Supabase. Se arregla añadiendo `conversationHistory` a `SECRET_KEYS.settings`, encolando el borrado tras `attach` y dejando una sola migración.
  3. **I3/I4:** los ejemplos del diccionario tienen ≈4 % de frases asignadas a una palabra que no contienen (我的哥哥 → `dī gē` en las 24), unas 300 lecturas de polífonos mal elegidas (`zhè zhǐ`) y unas 350 frases con tradicionales (於, 乾). Se arregla con segmentación inversa, 5 lecturas por defecto y un mapa de caracteres antes de regenerar.
