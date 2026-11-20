# Traducir el contenido al español

Infraestructura para traducir el **contenido de estudio** (lecciones, temas,
lecturas, gramática, vocabulario HSK, frases) al español **sin tocar los
motores**: los módulos siguen leyendo el mismo JSON, solo cambia de qué archivo
lo leen.

- `src/data-url.js` — elige el archivo según el idioma activo (`getLocale()`).
- `scripts/check-es-data.mjs` — valida las traducciones contra su original.
- `tests/data-url.test.mjs`, `tests/check-es-data.test.mjs` — las pruebas.

## 1. Convención de archivos

```
public/data/<ruta>.json        contenido en inglés (original, no se toca)
public/data/es/<ruta>.json     traducción COMPLETA (misma estructura, mismas
                               claves, mismos ids, mismos valores no traducibles)
```

Una traducción es una **copia estructural exacta** del original: no se añaden,
quitan ni renombran claves, no cambian los tipos, ni la longitud de las listas.
Si el original cambia, la traducción se actualiza en el mismo commit.

Ejemplos:

```
public/data/lessons/hsk1/lesson-01.json  ->  public/data/es/lessons/hsk1/lesson-01.json
public/data/themes/theme-01.json         ->  public/data/es/themes/theme-01.json
public/data/readings/hsk1/reading-01.json->  public/data/es/readings/hsk1/reading-01.json
public/data/grammar/pattern-01.json      ->  public/data/es/grammar/pattern-01.json
public/data/hsk/1.json                   ->  public/data/es/hsk/1.json
```

Los *shards* generados (`strokes/`, `radicals/`, `etymology/`) y los listados de
build (`files.json`, `manifest.json`) **no se traducen**: son datos de máquina.
`--coverage` los ignora. El diccionario (`es/dict/`) se traduce aparte con su
propio proceso (§5): **no forma parte del listado `es/files.json`** —lo carga
`src/dictionary.js` bajo demanda— y **ningún shard del diccionario entra en el
precache del service worker**.

### Listado opcional `public/data/es/files.json`

Si existe, es la lista de archivos traducidos (mismos nombres relativos que el
listado inglés, `[{ "file": "lessons/hsk1/lesson-01.json", "bytes": 3723 }]` o
una lista de cadenas). Sirve para que la app no tenga que probar con un 404 cada
archivo. **Es una optimización, no un requisito**: una traducción que existe en
el disco se encuentra igualmente aunque nadie actualice el listado.

## 2. Cómo lo usa la app

```js
import { dataUrl, fetchData, hasLocalizedData } from '../data-url.js';

const url = await dataUrl('lessons/hsk1/lesson-01.json');   // string listo para fetch
const lesson = await fetchData('lessons/hsk1/lesson-01.json'); // ese JSON ya parseado
const hay = await hasLocalizedData('themes/theme-01.json');  // ¿existe la versión es?
```

- Con el idioma en `es`, `dataUrl` devuelve `data/es/<ruta>` si el archivo existe
  (según el listado o tras probarlo una vez) y **cae al inglés**
  (`data/<ruta>`) si no existe, si el servidor responde 404 o si no hay red.
- La primera prueba de un archivo ausente se recuerda: **no se repite el 404**.
  `resetCache()` olvida esa memoria (tests) y `configure({ base, fetch })` inyecta
  base y `fetch` (tests y workers).
- Las URLs se construyen contra `document.baseURI`, así que funcionan también en
  un subdirectorio de GitHub Pages; nunca hay `/data/...` absoluto en el código.
- `hasLocalizedData(path)` responde "¿está traducido?" sin depender del idioma
  activo.

El módulo es puro (no toca el DOM, no depende de pantallas): se puede usar desde
cualquier motor que hoy lea `/data/...` sustituyendo su `fetch` por `fetchData`.

## 3. Reglas de traducción

**Tono**

- Español **neutro** y **tuteo** ("elige la respuesta", no "elija" ni "vos").
- Frases cortas, sin jerga; se traduce lo que se diría de verdad en español, no
  palabra por palabra.
- Se conservan los signos de apertura: `¿Qué significa 谢谢?`, `¡de nada!`.

**No se traduce nunca**

- `hanzi`, `pinyin` (ni `pinyinNumeric` / `pinyinTone`), `audio`, `tokens`,
  `answer` de `order` (es chino), `id`, `type`, `speaker`, `file`, `url`, `level`,
  `icon`, `emoji`, `tone`, números, booleanos, claves `*Key` (son claves de i18n)
  y cualquier cadena que sea solo chino (títulos de lecturas como `你好！`).
- Nombres propios: `王明` se queda `Wang Ming`, no se "españoliza".
- La app es **solo chino simplificado**: nunca caracteres tradicionales.

**Terminología fija** (misma palabra en todo el contenido)

| inglés | español |
| --- | --- |
| review / SRS | repaso |
| card | tarjeta |
| lesson | lección |
| streak | racha |
| achievement | logro |
| theme | tema |
| reading | lectura |
| dictation | dictado |
| settings | ajustes |

**Ejercicios: la respuesta tiene que seguir apuntando a lo mismo**

- `choose` / `listen`: si en el original `answer` es una de las `options`, en la
  traducción debe ser **la opción traducida en la MISMA posición**. Se pueden
  reordenar las opciones siempre que `answer` apunte al mismo índice.
- Si `answer` es un número (índice), sigue siendo el mismo número.
- `match`: cada `pairs[i].hanzi` debe ser idéntico al original (la alineación es
  posicional); se traduce `pairs[i].english`.
- `order`: `tokens` y `answer` no se tocan.

**Ortografía**

- Acentos y ñ siempre: `añadir`, `lección`, `español`, `número`, `después`,
  `también`… El validador avisa de las palabras típicas escritas sin tilde.
- Ninguna cadena traducible puede quedar vacía.

## 4. Cómo validar

```sh
node scripts/check-es-data.mjs                 # todos los public/data/es/**/*.json
node scripts/check-es-data.mjs lessons/hsk1    # un archivo o un directorio
node scripts/check-es-data.mjs --coverage      # qué falta por traducir
```

- Salida de error: `ERROR es/<ruta> :: <ruta JSON> :: <mensaje>`, por ejemplo
  `ERROR es/lessons/hsk1/lesson-01.json :: $.exercises[0].answer :: la respuesta "adiós" deberia ser la opcion 0 traducida ("gracias")`.
- Sale con código **1** si hay algún error (0 si todo está bien). `--coverage`
  siempre sale con 0: es información, no un veto.
- `--root <dir>` valida un árbol distinto del repo (tests).

Antes de dar una traducción por buena: `node scripts/check-es-data.mjs <ruta>` y,
si el archivo lo lee un motor, abrir la pantalla correspondiente
(`#/learn/<area>`, `#/extras/<area>`) con el idioma en español.

## 5. Diccionario en español (`public/data/es/dict/`)

Las definiciones del diccionario (CC-CEDICT) también están traducidas al
español. Es un caso aparte del resto del contenido: el diccionario tiene su
propia tubería, no lo lee `data-url.js` y sus shards **no** se anuncian en
`es/files.json` ni se precargan; `src/dictionary.js` los pide bajo demanda.

```
public/data/dict/shards/NNN.json        original inglés (no se toca)
public/data/es/dict/shards/NNN.json     [{id, defs:[...]}] traducción por id
public/data/es/dict/index-spanish/<a-z>.json   palabra es -> shards (búsqueda es)
```

- **Traducción:** `scripts/dict-priority.mjs` ordena las entradas por
  importancia, y `scripts/translate-dict.mjs` las traduce con un LLM
  (**Claude Haiku** o, en su defecto, OpenRouter) por lotes, de forma
  reanudable. Es una obra derivada de CC-CEDICT y se distribuye bajo la misma
  licencia (**CC BY-SA 4.0**, © MDBG y colaboradores) — ver `CREDITS.md` §1a.
- **Reparación determinista:** `node scripts/fix-dict-es.mjs` arregla sin LLM
  los marcadores de CC-CEDICT que se colaron en inglés (`used in` → `se usa en`,
  `CL:` → `clasificador:`, `(Tw)` → `(Taiwán)`…) y fusiona definiciones
  duplicadas dentro de una entrada.
- **Validación:** `node scripts/validate-dict-es.mjs` recorre **todos** los
  shards y compara cada entrada con su original inglés (ids, hanzi/pinyin,
  marcadores traducidos, fugas de inglés, longitud, duplicados). Sale con 1 si
  hay errores. Un puñado de entradas con diferencias aceptadas está en
  `scripts/dict-es-exceptions.json`: no cuentan como error y se informan aparte.
  (Las notas parentéticas tipo `(onom.)`, `(golf)` o `(c. 1200-1300)` son
  avisos, no errores.)
- **Índice de búsqueda:** `node scripts/build-dict-es-index.mjs` (lo ejecuta
  `npm run build` si hay shards es) genera `index-spanish/`: palabra española
  (sin acentos, sin palabras vacías) → shards. La búsqueda en español la usa
  primero y luego cae al inglés (ver `src/dictionary.js`).

```sh
node scripts/fix-dict-es.mjs          # reparación determinista (opcional)
node scripts/validate-dict-es.mjs     # 0 errores antes de comitear
node scripts/build-dict-es-index.mjs  # regenera index-spanish/
```
