# Revisión de diseño — ronda 2 (sistema "papel y tinta")

Fecha: 2026-11-20 · Build revisada: `OUT_DIR=/tmp/chino-t_2abc845a` (sha sw `3d6d91260b21`, commit de trabajo `94c7acc`).
Método: capturas propias con Chrome headless por CDP a 390×844 táctil (DPR 2), claro y oscuro, es y en. Modo Operate (interfaz de app). Sin cambios en código, datos ni tests.
Capturas: `/tmp/chino-t_2abc845a/shots/` (revisadas con visión: Inicio nuevo y con datos, Aprender, lección intro/vocabulario/elegir (fallo y acierto)/emparejar/ordenar/escuchar/resultado, Repaso frontal y trasera, Leer (pinyin on/off y lista), Diccionario 谢谢 (claro y oscuro), Trazos 戴, Hoja de caligrafía 妈妈, Ajustes, Más, Inicio en inglés oscuro, feedback en inglés).
No revisado con visión en esta ronda: estados vacíos (el harness siembra 3 tarjetas), emparejar con feedback, 320 px, la mayoría de pantallas en inglés, Trazos/Ajustes/Caligrafía en oscuro.

## 1. Veredicto

1. La base es sólida: una cosa grande por pantalla, hanzi en cuadrícula, pinyin con tonos legible, controles de 44 px o más, contraste medido por encima de 4,5:1 en todos los textos.
2. El bucle de aprendizaje falla en el momento del error: "Casi" sin decir cuál era la respuesta, resultado final sin salida, feedback que no se anuncia a lectores de pantalla.
3. La jerarquía de los menús es plana: "Aprender" y "Más" son 12 azulejos iguales, y casi todo lo interactivo es una caja con el mismo borde.
4. El diccionario muestra definiciones solo en inglés dentro de una interfaz en español.
5. Puntuación Nielsen: **23/40 (Aceptable)**. Carga cognitiva: **4 de 8 fallos** (alta, en los menús).

Puntuación por heurística (escala 0–4, critique-rubric; las 10 aplican en Operate):

| # | Heurística | Puntos | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 3 | Progreso y feedback visibles; el feedback no se anuncia (4.1.3) y el resultado no dice qué hacer después |
| 2 | Sistema ↔ mundo real | 2 | "Clásico / Inversa / Solo mis fallos"; definiciones en inglés en UI española; chip "Pinyin" sin explicar |
| 3 | Control y libertad | 2 | No hay repetir lección ni revisar fallos; solo "Terminar" |
| 4 | Consistencia | 3 | `.btn`/`.chip` compartidos bien; desvíos: rejilla de trazos sólida, Leer en tarjetas con caja |
| 5 | Prevención de errores | 3 | "Comprobar" deshabilitado hasta elegir; sin acciones destructivas en el flujo |
| 6 | Reconocer antes que recordar | 2 | Ejercicios sin pinyin; 16 palabras de vocabulario antes del primer ejercicio |
| 7 | Flexibilidad y eficiencia | 2 | Camino lineal; el repaso con modos es lo único flexible |
| 8 | Estética y minimalismo | 3 | Calma y jerarquía en Inicio y Repaso; los menús de 12 cajas iguales restan |
| 9 | Recuperación de errores | 1 | "× Casi" no nombra el problema ni la corrección |
| 10 | Ayuda y documentación | 2 | Nada explica tonos o pinyin en el primer recorrido; "Tonos y pinyin" no está enlazado desde la primera lección |
| | **Total** | **23/40** | Aceptable (57 %) |

Carga cognitiva (checklist de critique-rubric, 8 ítems): fallan **chunking** (12 ítems en Aprender), **≤4 opciones** (12 azulejos en Aprender y Más), **disclosure progresivo** (Más, todo plano) y **memoria de trabajo** (16 palabras y luego el ejercicio sobre ellas). Cuatro fallos = carga alta en los menús.

## 2. Lo que funciona y no hay que tocar

- **Inicio con progreso nuevo**: "Continuar: Saludos y números" es el paso único y se lee en 1 segundo. Mantener.
- **Hanzi en la cuadrícula** (`.hz-cell`): es el elemento memorable y funciona en Repaso (你好 en `.lg`) y en Diccionario. Mantener el patrón.
- **Pinyin con tonos por color y diacrítico**: el tono va en diacrítico, así que el color no es el único canal. Legible a 16 px. Mantener.
- **Ejercicio "elegir" con acierto**: "✓ ¡Correcto!" con icono, texto y fondo jade. Es el mejor feedback de la app. Usarlo como modelo para el fallo.
- **Botones de Repaso**: "Otra vez / Difícil / Bien / Fácil" con intervalo debajo, 4 en fila. Entendibles.
- **Modo oscuro**: los tokens funcionan. El acento jade 8,22:1 y los tonos ≥ 6,9:1 sobre superficie. El texto secundario baja a 7,05 en `inset`. Mantener la paleta.
- **Barra inferior de 6 pestañas con icono + etiqueta**: nombres claros, estado activo visible.
- **Cuadrícula de caligrafía y hoja 妈妈**: estructura por pasos con "Ver trazos", "Copiar como texto". Bien.
- **Carga y guardas**: `check-contrast.mjs` pasa 212/212 vistas (390 px, claro/oscuro, es/en), tonos y ajustes OK, sin origen externo.

## 3. Hallazgos (P0 → P3)

**P0 (bloquea / ilegible / inaccesible):** ninguno. En 390 px nada impide completar la lección ni es ilegible. El hallazgo más grave es P1-1.

**P1 (confusión grave o incumple AA)**

**P1-1 · Lección · ejercicio "elegir" tras fallar**
- Se ve: borde rojo sobre "一", borde discontinuo sobre la correcta "二" y "× Casi" en rojo claro. La respuesta correcta no aparece como texto.
- Por qué importa al principiante: el error es la lección. Sin la respuesta correcta vuelve a fallar la misma pregunta. "Casi" además sugiere acierto parcial.
- Causa: `src/learn/lessons.js:339` usa `t('learn.lessons.incorrect')`; `src/locales/es.d/learn.json:17` = `"incorrect": "Casi"`. El examen (`exam.js:486`) sí muestra `correctAnswer`; la lección no.
- Corrección: texto de fallo con la respuesta: `Incorrecto. La respuesta es 二 (dos).` Mismo cambio en en/es. Pasar la respuesta correcta como argumento a `t()`.
- Comando: `/impeccable clarify` (luego `harden` para la parte de anuncio).

**P1-2 · Lección · pantalla de resultado**
- Se ve: "Lección completada / Has acertado 3 de 8." y un único botón "Terminar". Barra al 37 %.
- Por qué importa: 3 de 8 sin salida deja al principiante sin qué hacer. Desmotiva y no repasa lo fallado.
- Corrección: botón secundario "Repetir lección" y botón principal "Repasar lo que fallé" que llama a `srs.addToReview` por cada fallo. `learn.json` líneas 22–24 solo tiene `result` y `finish`.
- Comando: `/impeccable onboard` (estado final) + `clarify`. Esfuerzo M.

**P1-3 · Lección · feedback no anunciado (WCAG 4.1.3, AA)**
- Se ve: "✓ ¡Correcto!" / "× Casi" aparecen sin anuncio. `grep aria-live` en `src/learn` no devuelve nada salvo `draw.js`.
- Por qué importa: un usuario de lector de pantalla no sabe si acertó.
- Corrección: contenedor del feedback `role="status" aria-live="polite"` (en `exercise-ui` y en el resultado). Sin mover el foco.
- Comando: `/impeccable harden`. Esfuerzo S.

**P1-4 · Diccionario · definiciones solo en inglés en UI española**
- Se ve: 谢谢 → "to thank / thanks / thank you" con la UI en español. Lección y vocabulario sí tienen español ("tú (singular)").
- Por qué importa: el hispanohablante principiante no entiende la definición.
- Corrección: si existe glosa española (`sentences-es`, o la de la lección), mostrarla primero; si no, etiqueta "Definiciones en inglés". `src/dictionary.js` indexa solo inglés.
- Comando: `/impeccable clarify` + trabajo de contenido (M–L).

**P1-5 · Aprender · 12 azulejos iguales**
- Se ve: `es-390-light-learn-hub`: 12 tarjetas con el mismo peso (课 调 拼 笔 句 题 听 玩 部 难 法 计). Primera decisión del menú y no hay grupos.
- Por qué importa: más de 4 opciones sin agrupar; el principiante no sabe por dónde empezar.
- Corrección: tres bloques con cabecera de texto: **Empieza** (Lecciones HSK, Tonos y pinyin, Tabla de pinyin), **Practica** (Frases, Temas, Dictado, Juegos, Palabras difíciles, Radicales), **Profundiza** (Gramática, Plan de 30 días).
- Comando: `/impeccable layout`. Esfuerzo S.

**P2 (fricción real, no bloquea)**

**P2-1 · Ejercicios sin pinyin.** En "elegir" ("¿Qué significa 谢谢?"), "emparejar" y "ordenar" el hanzi aparece sin pinyin. `public/data/lessons/hsk1/lesson-01.json` sí trae `pinyin` en la escucha, pero la UI no lo pinta. Corrección: `pinyinHtml(...)` bajo el enunciado cuando el pinyin está activo. Comando: `/impeccable typeset`.

**P2-2 · Vocabulario largo.** 16 entradas, cada una con "Añadir al repaso" (16 cajas). El botón que avanza está al final. Corrección: un "Añadir todas al repaso" arriba y botón compacto por fila, o desplegar ejemplos. Comando: `/impeccable distill`.

**P2-3 · Repaso con jerga.** Chips "Clásico", "Inversa", "Escribir pinyin", "Solo mis fallos". Corrección: una línea debajo de cada chip ("Ves el hanzi, dices el significado"). Comando: `/impeccable clarify`.

**P2-4 · Chip "Pinyin" en cabecera de cada ejercicio.** Ocupa 79×48 px arriba del contenido. Su estado activo (borde verde) se confunde con selección de respuesta. Corrección: moverlo a Ajustes o mostrar "Pinyin: sí / no" como texto (ya tiene `aria-pressed`). Comando: `/impeccable layout` + `clarify`.

**P2-5 · Barra inferior a 10 px.** Medido: `.tab-label` = 10 px, barra de 61 px. Dentro de la cota, pero en 320 px y para un principiante es el texto más pequeño. Corrección: 11 px mínimo. Comando: `/impeccable typeset`. Ver §6 (contradicción con DESIGN.md).

**P2-6 · Reducción de movimiento mata el feedback.** `src/styles.css:696-703` pone `0.001ms` a todo. Anula `shake` (fallo) y `pop` (acierto). El color y el texto siguen, así que es menor, pero el playbook de audit lo marca. Corrección: en `prefers-reduced-motion` quitar solo `animation` de `.btn.is-wrong` y `.btn.is-correct` y dejar el `box-shadow`/borde que ya marca el estado. Comando: `/impeccable animate`.

**P2-7 · Foco perdido en escritura.** `src/learn/typing.js:71`: `.typing-input:focus { outline: none; border-color: var(--accent) }` anula el anillo global de 3 px (`styles.css:114`). El cambio de borde (3,97 → 6,69) existe, pero no es el anillo del sistema. Corrección: quitar `outline: none` y usar `:focus-visible`. Comando: `/impeccable harden`.

**P2-8 · Trazos.** Botón "Mostrar" junto al campo sin explicar; en Caligrafía el mismo gesto se llama "Ver trazos". La rejilla es una cruz sólida mientras el resto usa la punteada de `.hz-cell`. Corrección: "Ver trazos" y rejilla punteada. Comando: `/impeccable clarify` + `polish`.

**P2-9 · Leer · botón Pinyin apagado vs encendido.** Encendido: borde verde y tinte; apagado: borde gris y fondo. La diferencia es sutil a 390 px. Corrección: "Pinyin: sí / no" como texto. Comando: `/impeccable clarify`.

**P2-10 · Todo tiene caja.** Repaso, Diccionario, Trazos y Leer usan el mismo borde para acciones primarias y secundarias; el primario se distingue solo por el relleno. Corrección: secundarias como `.btn.ghost` (ya existe en DESIGN.md §3). Comando: `/impeccable quieter`.

**P3 (detalle)**

- **P3-1** Lista de lecturas: títulos en chino sin pinyin (你好！, 我的家). Añadir pinyin pequeño. `/impeccable typeset`.
- **P3-2** `src/learn/games/memory.js:39`: `linear-gradient(135deg, var(--surface), var(--surface))` no hace nada, pero es un degradado. Quitarlo. `/impeccable polish`.
- **P3-3** `--focus` se usa en `styles.css:115` y no está en la tabla de tokens de DESIGN.md §2. Documentarlo.
- **P3-4** Diccionario: "to thank / thanks / thank you" repite una idea. Mostrar una. `/impeccable distill`.
- **P3-5** Speaker "A" / "B" en Leer: 13 px, 28×23 px, sin nombre accesible. `aria-label="Hablante A"`. `/impeccable harden`.

## 4. Accesibilidad (medido)

**Contraste** (ratio calculado con la fórmula WCAG 2.1 sobre los tokens de `docs/DESIGN.md` §2; la suite `check-contrast` confirma en DOM):

| Par | Ratio | Umbral | Estado |
|---|---|---|---|
| ink-soft claro / surface | 6,95 | 4,5 | OK |
| ink-soft claro / inset | 5,81 | 4,5 | OK |
| accent claro / surface | 6,69 | 4,5 | OK |
| accent-fg / accent (botón primario) | 6,57 | 4,5 | OK |
| danger claro / surface | 6,91 | 4,5 | OK |
| tone1 / tone2 / tone3 / tone4 / tone5 claro / surface | 6,27 / 5,54 / 6,43 / 6,22 / 5,39 | 4,5 | OK |
| edge claro / surface (borde de control) | 3,97 | 3 | OK (justo) |
| ink-soft oscuro / inset | 7,05 | 4,5 | OK |
| accent oscuro / surface | 8,22 | 4,5 | OK |
| tone1 oscuro / surface | 7,25 | 4,5 | OK |
| edge oscuro / surface (borde de control) | 3,73 | 3 | OK (justo) |
| line claro / surface | 1,39 | — | Solo decoración (correcto que no sea límite de control) |
| danger sobre danger-wash (estimado, ~12 % mezcla) | ≈5,4 | 4,5 | OK, estimado |
| accent sobre accent-wash (estimado) | ≈6 | 4,5 | OK, estimado |

Los estados deshabilitados (botón "Comprobar" antes de elegir) están exentos de WCAG; se ven en tono apagado, correcto.

**Objetivos táctiles** (medidos en DOM, `getBoundingClientRect`):
- Opciones de ejercicio: 56 px de alto, 16 px de texto. OK.
- Chip Pinyin: 79×48 px. OK.
- Botones de Repaso y Diccionario: 44–52 px. OK.
- Barra inferior: 61 px de alto, pestañas ≥ 44 px. OK.
- Palabra en lectura (`.word`): 30×48 px. Ancho menor que 44, exento por el DESIGN.md §6.3 (texto en línea). Cumple WCAG 2.5.8 (≥ 24 px).
- Speaker A/B: 28×23 px, no es control. OK.
- Ningún botón o enlace por debajo de 44×44 en Inicio ni en Trazos (`small-targets-home` vacío).

**Otros (WCAG 2.1):**
- 1.1.1 / 4.1.2: la palabra del día y los botones de audio tienen texto visible. El `alt` y los nombres accesibles no se revisaron en código.
- 3.1.2: el hanzi lleva `lang="zh-Hans"` (`src/hanzi.js:12`). OK.
- 2.4.7: anillo global 3 px con `--focus`. Excepción en `typing.js` (P2-7).
- 4.1.3: sin `aria-live` en feedback ni resultado (P1-3).
- Reducción de movimiento: existe, pero mata el feedback (P2-6).
- Pendiente de verificación con teclado real: orden de foco en ejercicios y resultados. No ejecutado.

## 5. Aspecto de "plantilla genérica" que queda

Detector humano del playbook: tipografía, degradados, tarjetas anidadas, relleno, iconos en recuadro.

- **Tipografía**: Onest única familia, sin serif de "cultura china de postal". OK.
- **Degradados**: ninguno visible; solo el no-op de P3-2.
- **Sombras**: ninguna de caída; solo sombras de estado (anillo de selección). OK.
- **Mayúsculas**: no hay en los headings (verificado: `text-transform: none`).
- **Tarjetas anidadas**: no en Inicio ni en Repaso; sí en Más y Aprender (12 tarjetas iguales en cuadrícula de 2 columnas). Es el patrón de "kit de tarjetas SaaS" (ux-craft R4). **Lo que queda de plantilla.**
- **Iconos en recuadro**: los emblemas de hanzi dentro de tarjetas en Aprender y Más son identidad (DESIGN.md §3), pero repetidos 12 veces con el mismo tamaño se leen como plantilla. Reducir la repetición con los grupos de P1-5.
- **Relleno apretado**: no. Márgenes amplios y consistentes (16 px).
- **Todo es caja**: P2-10. Es el único rasgo que hace la interfaz más genérica de lo que el sistema quiere.

## 6. Propuesta de segunda ronda (máximo 12, por rentabilidad para el principiante)

| # | Cambio | Esfuerzo | Comando | Rentable para principiante |
|---|---|---|---|---|
| 1 | Feedback de fallo con la respuesta correcta; quitar "Casi" | S | clarify | **Sí, la más rentable** |
| 2 | Pinyin bajo el enunciado/hanzi en elegir, emparejar y ordenar | S | typeset | **Sí** |
| 3 | Resultado: "Repetir lección" + "Repasar lo que fallé" | M | onboard + clarify | **Sí** |
| 4 | `aria-live` en feedback y resultado | S | harden | Accesibilidad obligatoria |
| 5 | Aprender en 3 grupos con cabecera | S | layout | **Sí, primera decisión** |
| 6 | Más en 3 grupos con cabecera | S | layout | Medio |
| 7 | Diccionario: glosa en español o etiqueta "inglés" | M–L | clarify | Sí, pero requiere contenido |
| 8 | Repaso: una línea de explicación por modo | S | clarify | Medio |
| 9 | Barra inferior a 11 px y revisión de 320 px en es | S | typeset | Medio |
| 10 | Reducción de movimiento sin matar shake/pop | S | animate | Bajo |
| 11 | Anillo de foco en `typing-input` | S | harden | Bajo (teclado) |
| 12 | Vocabulario: "Añadir todas" en lote en vez de 16 botones | M | distill | Medio |

Orden sugerido: 1 → 2 → 4 → 5 → 3 → resto. Los cambios 1, 2 y 4 son de texto y atributos; no tocan el sistema visual.

**Tres cosas que no conviene hacer:**
1. No ocultar ni quitar el pinyin por defecto, ni cambiar hanzi por iconos. Es lo que el principiante necesita y el sistema ya lo resuelve.
2. No añadir gamificación (racha, puntos, mascota, confeti) antes de arreglar el bucle del error (cambios 1–3). Adorna un flujo que todavía no enseña.
3. No subir el contraste de `--line` ni añadir sombras o degradados "para dar vida". La paleta cumple 4,5:1 en todos los textos; la jerarquía se arregla con tipografía y agrupación (cambios 5, 6, 9), no con decoración.

## 7. Primera experiencia del principiante (Inicio → primera lección → primer ejercicio)

1. **Inicio (sin progreso).** Entiende "Continuar: Saludos y números" y el botón grande. *Duda*: no sabe qué es la app ni qué significa "Saludos y números". La "Palabra del día" (坐 zuò, sentarse) aparece sin contexto. No hay bienvenida ni explicación del pinyin.
2. **Aprender → Lección.** Intro con el chip "Pinyin" arriba. *Duda*: el chip parece una pestaña o un título; no se entiende que es un interruptor ni qué hace. Pasa a "Siguiente" con poca información.
3. **Vocabulario.** 16 palabras en una lista larga, cada una con "Añadir al repaso". *Se pierde*: no ve de inmediato el botón que avanza (está al final). Demasiadas decisiones (16 botones de repaso) antes del primer ejercicio.
4. **Primer ejercicio: "¿Qué significa 谢谢?"** Opciones claras (gracias / adiós / de nada). *Duda*: el hanzi aparece sin pinyin; si no recuerda 谢谢 de la lista de arriba, no tiene pista de cómo se pronuncia ni de cuál buscar.
5. **Fallo.** Ve "× Casi" en rojo. *Se pierde aquí*: no sabe cuál era la correcta (la única pista es un borde discontinuo). "Casi" da a entender acierto parcial.
6. **Acierto (ejercicio 1 de 8 en otra pasada).** "✓ ¡Correcto!" claro. Este es el punto de confianza que hay que replicar tras el fallo.
7. **Resultado.** "Has acertado 3 de 8" y solo "Terminar". *Se pierde*: no hay repetir, no hay repaso de fallos, no hay siguiente paso. El principiante abandona aquí o vuelve a empezar sin saber qué cambiar.

**Estados vacíos**: no revisados (el harness siembra 3 tarjetas y las capturas de Inicio muestran "Repasar (3)"). La captura de Inicio sin datos muestra el estado real de primer uso.

## 8. Contradicciones con docs/DESIGN.md

Lo digo explícitamente, como pide la tarea:

1. **§4 y §3: "Lists are hairline rows without boxes (…reading)"**. La lista de lecturas (`#/read`) se ve como tarjetas con caja y chevron (`read-list-light-es.png`). El código usa `.card.field`, no fila. **Contradicción**: o se actualiza el documento, o las lecturas pasan a filas.
2. **§3: "labels are 10 px on purpose"** (barra inferior). La medición confirma 10 px. No contradice el código, pero es una decisión que no comparto para un principiante que usa 320–390 px. Recomiendo 11 px (cambio 9).
3. **§5: "Under prefers-reduced-motion every animation and transition is effectively off"**. Es coherente con el código, pero el playbook de audit pide conservar el cambio de estado. Discrepo solo en shake/pop (P2-6).
4. **§1 y §3: rejilla "田字格 dashed"**. La pantalla de Trazos usa una cruz sólida (P2-8). **Contradicción de implementación**.
5. **§2: tabla de tokens**. Falta `--focus`, que el CSS usa (P3-3). **Deriva de documentación**.

## Notas de ejecución

- El lanzador `scripts/impeccable` no se ejecutó (instalación local a propósito). Contexto leído de `docs/DESIGN.md` y del código.
- Capturas hechas con `scripts/lib/audit.mjs` (launchChrome, startServer) y un script propio en `~/.hermes/profiles/haiku/cache/scratch/`, fuera del repo.
- `check-contrast.mjs` corrido con `WIDTHS=390` (212/212 vistas OK). El paso a 320 px no se ejecutó en esta ronda.
- No se modificó código, datos ni tests. No se subió nada. No se instalaron dependencias.
