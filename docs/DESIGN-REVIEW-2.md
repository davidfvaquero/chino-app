# Revisión de diseño — ronda 3 (sistema «papel y tinta»)

Fecha: 2026-11-20 · Tarea: t_7d7d3d2b · Solo informe: no se ha cambiado código, datos ni tests.
Build revisada: `git archive d09de8a` (HEAD en el momento de la revisión) compilado en `OUT_DIR=/tmp/chino-t_7d7d3d2b`. Los cambios sin commitear (`src/learn/typing.js`, `public/data/es/dict/`) no están en esa build.
Capturas: `/tmp/chino-t_7d7d3d2b/shots/` (212 vistas del barrido automático + `flows/`). Scripts de captura fuera del repo: `~/.hermes/profiles/haiku/cache/scratch/t_7d7d3d2b/`.
Método: Chrome headless por CDP, 390×844 táctil DPR 2, claro y oscuro, es y en. 320×700 en es. Rúbrica de `critique-rubric.md` (Nielsen 0–4, checklist de carga de 8 ítems). El lanzador `scripts/impeccable` no está instalado (decisión local); se leyó `docs/DESIGN.md` y el código directamente.

## 1. Veredicto

1. Nielsen **27/40 (Aceptable)**, frente a 23/40 de la ronda 2: +4. Sigue en la banda «Aceptable»; no llega a «Bueno» (28).
2. Lo que se pidió en la ronda 2 está mayormente resuelto en pantalla: el fallo ya dice la respuesta, el resultado ofrece «Repasar lo que fallé» y «Repetir lección», el pinyin va bajo los hanzi en elegir, emparejar y ordenar, y las barras son de 11 px sin cortes en 320 px.
3. Quedan tres fallos P1 nuevos o no vistos antes: la hoja de trazos mezcla inglés y jerga en español, los hanzi de esa hoja no llevan `lang="zh-Hans"`, y la pantalla de Cuenta remite a `docs/SYNC.md`, una ruta de desarrollador.
4. La carga de los menús sigue alta: Aprender tiene 8 opciones en un mismo grupo, Más tiene 13 visibles sin plegar y la lección muestra 16 palabras antes del primer ejercicio. La checklist da **4 de 8 fallos** (igual que la ronda 2, pero distintos).
5. Contraste, objetivos táctiles y solapes: 0 fallos en 212 vistas medidas en DOM. Lo que se ve mal no es el sistema visual, sino el contenido y la jerarquía de algunas pantallas.

## 2. Puntuación Nielsen (0–4, mismo rúbrico que la ronda 2)

| # | Heurística | Ronda 2 | Ronda 3 | Evidencia |
|---|---|---|---|---|
| 1 | Visibilidad del estado | 3 | 3 | `role="status" aria-live="polite"` en feedback, resultado, diccionario, typing y draw (DOM). Barra de progreso en cada ejercicio. Falta feedback en Caligrafía al descargar (solo texto `ws-hint`). |
| 2 | Sistema ↔ mundo real | 2 | 2 | Mejora: «Incorrecto. La respuesta es gracias.», glosa es «gracias» en el diccionario. Persiste: «ma; mom» y «woman» dentro de la hoja de trazos en español; «Quiz cronometrado», «Constructor de frases», «Números de tono (ni3 hao3)»; «docs/SYNC.md». |
| 3 | Control y libertad | 2 | 3 | Resultado con «Repasar lo que fallé», «Repetir lección», «Terminar». Repaso con 4 modos. No medido: a dónde lleva «Repasar lo que fallé». |
| 4 | Consistencia | 3 | 3 | `.btn`/`.chip` compartidos. Tres formas distintas de mostrar el mismo interruptor de pinyin: «Pinyin: Sí» (ejercicio, sin caja), «Sí» (Ajustes), «Activado» (tonos). Lecturas en tarjetas con chevron, no en filas como dice DESIGN.md. |
| 5 | Prevención de errores | 3 | 3 | «Comprobar» deshabilitado hasta elegir. Sin borrados ni acciones destructivas visibles en el flujo de aprendizaje. |
| 6 | Reconocer antes que recordar | 2 | 3 | Pinyin visible bajo la pregunta en elegir, en fichas de emparejar y en tokens de ordenar. «Siguiente» arriba y «Añadir todas al repaso» en Vocabulario. Pendiente: 16 filas antes del primer ejercicio. |
| 7 | Flexibilidad y eficiencia | 2 | 2 | Orden de foco lógico en ejercicios (Pinyin → opciones). Camino de lección todavía lineal. |
| 8 | Estética y minimalismo | 3 | 3 | Inicio limpio y Repaso con poco ruido. Trazos (hoja) y Plan 30 días densos. Hubs con 12–13 tarjetas iguales. |
| 9 | Recuperación de errores | 1 | 3 | El fallo nombra la respuesta correcta y el emparejar la muestra en rojo con los pares completos. Sin explicación de por qué (tonos), por eso no es 4. |
| 10 | Ayuda y documentación | 2 | 2 | Ajustes explica el pinyin en una frase. Repaso explica cada modo. Ninguna lección explica tonos en su primer uso. La única ayuda enlazada de Cuenta apunta a un archivo de desarrollo. |
| | **Total** | **23/40** | **27/40** | +4. No hay n/a: las diez heurísticas aplican en Operate. |

**Checklist de carga cognitiva (8 ítems):** fallan *chunking* (Aprender › Practica con 8 ítems), *mínimo de opciones* (Aprender y Más muestran 12–13 azulejos a la vez), *memoria de trabajo* (16 palabras antes del primer ejercicio) y *disclosure progresivo* (Más plano; sí hay un buen ejemplo en Conversación IA, con «Ajustes» plegado). **4 de 8 fallos → carga alta**, en los menús.

## 3. Los 12 cambios de la ronda 1

Criterio: lo que se ve en pantalla, no solo que el test pase.

| # | Cambio propuesto | Estado | Evidencia |
|---|---|---|---|
| 1 | Fallo con la respuesta correcta; quitar «Casi» | **Resuelto** | Captura `ex1-wrong-es`: «Incorrecto. La respuesta es gracias.» con `role=status`. «Casi» ya no aparece. |
| 2 | Pinyin bajo hanzi en elegir, emparejar y ordenar | **Resuelto** | Elegir: «xièxie» bajo la pregunta. Emparejar: pinyin en cada ficha (captura `ex-match-feedback`). Ordenar: «hǎo», «nǐ» bajo las fichas (captura `ex-order`). |
| 3 | Resultado: «Repetir lección» + «Repasar lo que fallé» | **Resuelto** | Captura `result-es`: jerarquía primario/secundario/texto correcta. Destino de «Repasar» no comprobado. |
| 4 | `aria-live` en feedback y resultado | **Resuelto** | DOM: `feedback-box` → `role=status aria-live=polite`; `lesson-result-status` → `polite`. El foco no se mueve. |
| 5 | Aprender en 3 grupos con cabecera | **Parcial** | Tres cabeceras (Empieza / Practica / Profundiza). Practica tiene 8 azulejos: no cumple «≤4 por grupo». |
| 6 | Más en 3 grupos con cabecera | **Parcial** | Tres cabeceras. Siguen 13 azulejos visibles sin plegar, y «Ayuda y acerca de» queda fuera del primer pantallazo. |
| 7 | Diccionario: glosa es o etiqueta «inglés» | **Parcial** | 谢谢: glosa «gracias» y «Definiciones en inglés» (captura `dict-xiexie`). La línea «Ver en inglés» solo aparece con los fragmentos `dict/` de es, que no están en el commit: en HEAD no se ve. |
| 8 | Repaso: una línea de explicación por modo | **Resuelto** | Captura `review-front`/`review-picker`: cuatro líneas bajo cada chip. |
| 9 | Barra inferior 11 px y 320 px en es | **Resuelto** | `.tab-label` 11 px (medido). 320 px: `Diccionario` 52/52 px, sin desborde (`dict320Overflow` 0). |
| 10 | `prefers-reduced-motion` sin matar shake/pop | **Resuelto** | Con reduce: `animation: none` en `.btn.is-wrong`, el borde rojo y el fondo se mantienen (medido). |
| 11 | Anillo de foco en `typing-input` | **No (en HEAD)** | En d09de8a no hay regla `:focus-visible`. El arreglo existe en el árbol de trabajo (`typing.js`, una línea) sin commit y sin verificar en navegador. Es el fallo A6 de `VERIFICATION.md`. |
| 12 | Vocabulario: «Añadir todas» en lote | **Resuelto** | Captura `lesson-vocab`: «Añadir todas al repaso» arriba, «Siguiente» arriba. Los 16 botones individuales siguen (ver P2-8). |

Resumen: **8 resueltos, 3 parciales, 1 no** (en HEAD).

## 4. Hallazgos nuevos

Pantalla y captura, qué se ve mal, por qué importa a un principiante, corrección concreta y comando de impeccable.

### P0 (bloquea)
Ninguno. Se puede completar la lección, repasar y usar el diccionario en 390 px y 320 px.

### P1 (confusión grave o incumple AA)

**P1-1 · Trazos › hoja de 妈妈 (`area-strokes-sheet-390-light-es`) · inglés y jerga en una interfaz en español**
- Se ve: «ma; mom», «Parte de significado: 女 woman · Parte de sonido: 马 woman», «tipos de trazo aprox.: 1 de derecha a abajo · 2 de izquierda a abajo…».
- Por qué importa: el principiante hispanohablante no entiende la hoja y lee una palabra inglesa como si fuera parte de la interfaz. El desglose de trazos es jerga de lingüística sin explicación.
- Corrección: mostrar la glosa en español cuando exista; si no, etiquetar «Significado (en inglés)». Mover «tipos de trazo aprox.» a un `<details>` cerrado.
- Comando: `/impeccable clarify`.

**P1-2 · Trazos › hoja de 妈妈 · hanzi sin idioma (WCAG 3.1.2, AA)**
- Medido: `SPAN lang=es` en cada hanzi de la hoja. El `lang` del `<html>` hereda `es`, así que un lector de pantalla leería 妈 con voz española.
- Por qué importa: el usuario de lector de pantalla no oye el carácter. Además es la pantalla que más se usa para aprender trazos.
- Corrección: `h('span', { lang: 'zh-Hans', text: char })` en `strokes-sheet` y en los demás hanzi sueltos (`.dict-hanzi`, vocabulario). En la página principal y el resultado sí va `zh-Hans` (medido 0 sin idioma).
- Comando: `/impeccable harden`.

**P1-3 · Más › Cuenta y sincronización (`area-account-390-light-es`) · ruta de desarrollador visible**
- Se ve: «Para sincronizar entre dispositivos, sigue docs/SYNC.md.» (es y en, `src/locales/*.d/account.json`).
- Por qué importa: el principiante no sabe qué es `docs/SYNC.md` y no tiene a dónde ir. Es una salida sin salida.
- Corrección: cambiar `notConfiguredHint` por «Esta versión no sincroniza entre dispositivos. Todo se guarda en este dispositivo.» (es) y su equivalente en en.
- Comando: `/impeccable clarify`.

### P2 (fricción real)

**P2-1 · Aprender › Practica (`learn-hub-390-light-es`)**: 8 azulejos en un solo grupo (Frases, Temas, Dictado, Juegos, Difíciles, Radicales, Examen, Escritura). Corrección: partir en dos grupos de 4 (o mover Examen y Escritura a Profundiza). Comando: `/impeccable layout`.

**P2-2 · Más (`more-hub-390-light-es`)**: 13 azulejos visibles de golpe; «Ayuda y acerca de» queda debajo del pliegue. Corrección: dejar visibles 8 y plegar «Herramientas avanzadas» con `<details>`. Comando: `/impeccable distill`.

**P2-3 · Juegos (`area-games-390-light-es`)**: el encabezado dice «Juegos de memoria» sobre cinco juegos, y solo uno es de memoria (`games.json`, clave `games`). Corrección: «Juegos». Comando: `/impeccable clarify`.

**P2-4 · Ejercicio (`ex1-es-390-light`, cabecera)**: «Pinyin: Sí» se ve como texto verde sin borde ni icono. Un principiante no lo reconoce como interruptor. Corrección: usar `.chip` (48 px, borde, `aria-pressed`) en la cabecera del ejercicio. Comando: `/impeccable clarify` + `/impeccable layout`.

**P2-5 · Ajustes (`settings-pinyin-section-es`)**: los dos interruptores tienen de nombre accesible solo su estado («Sí» y «Activado»). El título «Mostrar pinyin» está en un `<h2>` sin relación con el botón. Corrección: `aria-labelledby` apuntando al `<h2>`, y que el texto visible sea «Mostrar pinyin: Sí». Comando: `/impeccable harden`.

**P2-6 · Repaso sin tarjetas (`review-empty-bottom-es`)**: los cuatro modos (con sus líneas de explicación) aparecen encima de «Nada pendiente». Un principiante ve controles que no sirven. Corrección: ocultar `.rv-modes` cuando no hay tarjetas. Comando: `/impeccable onboard`.

**P2-7 · Trazos sin entrada (`area-strokes-390-dark-es`)**: pantalla casi vacía con un campo y «Ver trazos»; el texto de ayuda está vacío. Corrección: tres chips de ejemplo (你 · 好 · 妈) que rellenan el campo, y una línea «Escribe un carácter o toca uno de ejemplo». Comando: `/impeccable onboard`.

**P2-8 · Lección › Vocabulario (`lesson-vocab-es`)**: 16 filas con «Añadir al repaso» antes del primer ejercicio. «Siguiente» ya está arriba, pero la carga de memoria sigue. Corrección: mostrar 4 filas y `<details>` con «Ver las 12 restantes». Comando: `/impeccable distill`.

**P2-9 · Plan 30 días (`area-plan-390-light-es`)**: dentro de la tarjeta del día hay cuatro botones apilados de anchos distintos (Lección, Repaso, Lectura, Marcar); tarjeta dentro de tarjeta, sin rejilla. Corrección: `grid-template-columns: 1fr 1fr; gap: 8px` para los cuatro; «Marcar el día como hecho» como `.btn.ghost`. Comando: `/impeccable layout`.

**P2-10 · Caligrafía (`area-worksheet-390-dark-es`, `worksheet-gen-es`)**: tras generar, «Generar hoja» y «Descargar PDF» son los dos botones primarios iguales, lado a lado. Corrección: «Descargar PDF» como `.btn` y «Imprimir» como `.btn.ghost`; un solo primario. Comando: `/impeccable quieter`.

**P2-11 · Diccionario (`dict-xiexie-es`)**: los chips «谢» y «谢» parecen botones de carácter sin función; son enlaces a Trazos sin texto visible. Corrección: texto «Trazos:» antes del grupo o «Ver trazos de 谢» visible. Comando: `/impeccable clarify`.

**P2-12 · Juegos y Aprender (`area-games-390-light-es`)**: «Quiz cronometrado», «Constructor de frases», «Duelo de tonos» no dicen qué hacen. Corrección: una línea `.hint` bajo cada título. Comando: `/impeccable clarify`.

### P3 (detalle)

- **P3-1 · Diccionario en inglés (`dictionary-390-light-en`)**: no se limita a 3 definiciones; «Note: In Taiwan…» ocupa cuatro líneas. Comando: `/impeccable distill`.
- **P3-2 · Diccionario sin resultados (`dict-noresult-es`)**: solo «Sin resultados para «zzq».». Corrección: una línea con alternativa («Prueba con el pinyin, p. ej. ni hao, o con el significado en español»). Comando: `/impeccable clarify`.
- **P3-3 · Dictado (`area-dictation-390-light-es`)**: «Números de tono (ni3 hao3)» es jerga sin ejemplo ni explicación. Comando: `/impeccable clarify`.
- **P3-4 · Examen (`area-exam-390-light-es`)**: «Límite de tiempo (10 minutos)» tiene forma de botón de estado sin estado visible. Comando: `/impeccable clarify`.
- **P3-5 · Repaso vacío, una captura sin barra inferior**: en una pasada la barra no aparecía; en otra sí (medido: 783–844 px, `tab` en el punto central). No reproducido de forma estable; vigilar, probablemente animación de entrada. Comando: ninguno todavía.
- **P3-6 · Tipografía de ayuda en lecturas (`read-list-390-light-es`)**: el pinyin de los títulos va en tres colores de tono sobre la misma línea; legible, pero el tono también va en color (el diacrítico lo sostiene). Sin acción.

Nota de cierre: en P2 no hay más de 12 y en P3 hay 6 (la P3-5 y la P3-6 no requieren acción).

## 5. Principiante, otra vez (Inicio → lección → ejercicio → fallo → resultado)

1. **Inicio sin progreso.** Se entiende «Continuar: Saludos y números» y el botón grande. Sigue sin explicarse qué es la app: no hay una línea de bienvenida ni de qué es el pinyin. La palabra del día (坐 zuò, sentarse) aparece sin contexto.
2. **Aprender › lección 1.** La intro muestra «Pinyin: Sí» como texto. Se entiende que es algo de pinyin, no que se puede pulsar (P2-4). «Siguiente» está visible.
3. **Vocabulario.** «Siguiente» arriba: ya no se pierde. Siguen 16 filas antes del primer ejercicio, lo que se percibe como un muro (P2-8).
4. **Primer ejercicio: ¿Qué significa 谢谢?** El pinyin «xièxie» va bajo la pregunta: se puede leer sin haber memorizado. Opciones claras. Mejora clara frente a la ronda 2.
5. **Fallo.** «Incorrecto. La respuesta es gracias.» en rojo, con icono y texto, y el botón «Continuar». Ya no se pierde: sabe cuál era la correcta. Lo que no explica es por qué (tono, palabra parecida); no es grave.
6. **Resultado.** «Has acertado 2 de 8», barra y «Repasar lo que fallé» como botón primario. Queda claro qué hacer. No comprobado a dónde lleva «Repasar».

**Sigue perdiéndose en:** el paso 2 (no ve que «Pinyin: Sí» es un interruptor) y el paso 3 (la lista larga). En el paso 6 ya no se pierde, aunque no comprobamos la pantalla siguiente.

## 6. Estados vacíos, 320 px, inglés, oscuro, nuevas pantallas

- **Inicio primer uso** (`empty-home-es`): bien. «Continuar» único y palabra del día. Sin bienvenida (P-Inicio en la sección 5).
- **Repaso sin tarjetas** (`empty-review-es`): mensaje «Nada pendiente» y CTA «Ir al diccionario»: bien. Los modos encima sobran (P2-6).
- **Diccionario sin resultados** (`dict-noresult-es`): mensaje correcto, sin alternativa (P3-2).
- **Leer sin lecturas**: no aplica. La lista es fija; no hay estado vacío que revisar.
- **Trazos sin entrada**: pantalla casi vacía (P2-7).
- **320×700 en es**: sin desborde en Inicio, Lección, Diccionario (medido `scrollWidth − innerWidth` = 0). Barra inferior 11 px sin cortes. El botón «Continuar: Saludos y números» pasa a dos líneas y se lee bien.
- **Todas las pantallas en inglés**: sin texto en español suelto en Inicio, Aprender, Más, Diccionario ni Lección. En Trazos (hoja) y en Caligrafía sí hay inglés (P1-1).
- **Oscuro**: Trazos, Ajustes y Caligrafía se leen. Contraste medido 0 fallos en 212 vistas, claro y oscuro. En Caligrafía, «Descargar PDF» en oscuro sin hoja queda muy apagado (es el estado deshabilitado, correcto) (ver P2-10).
- **Caligrafía en PDF**: el botón «Descargar PDF» se activa al generar la hoja y el estado pasa a «PDF descargado.». La vista previa muestra filas de 妈 con la cuadrícula punteada y los trazos numerados (buena). No inspeccioné el archivo PDF: la descarga en headless no lo guardó en disco. El contenido real del PDF queda sin verificar.
- **Diccionario con glosa es y «Ver en inglés»**: la glosa «gracias» sale de la lección. «Ver en inglés» requiere los fragmentos `public/data/es/dict/`, que no están en el commit: en HEAD no aparece (ver §3, cambio 7).
- **Interruptor global de pinyin y chips «Pinyin: sí/no»**: funcionan (chip `aria-pressed=true`, texto «Sí»). Falta nombre propio (P2-5).
- **Resultado con «Repasar lo que fallé»**: correcto (ver §5).
- **Aprender y Más agrupados**: los grupos son claros; la densidad no (P2-1, P2-2).
- **Juegos, Dictado, Plan 30 días, Examen, Conversación IA, Anki, Cuenta/sync**: revisados con visión (ver §4). Conversación IA plega sus ajustes y deja claro que necesita un proveedor. Anki tiene un párrafo largo con las columnas del archivo (sin hallazgo formal; candidato a `<details>`). Cuenta: P1-3.

## 7. Accesibilidad medida

**Contraste (DOM, `AUDIT_FN` del harness, 212 vistas):** 0 textos por debajo de 4,5:1 (3:1 en grande), 0 bordes de campo/botón/chip por debajo de 3:1. Ratios de los tokens (`DESIGN.md` §2), calculados en la ronda 2 y no recalculados hoy: ink-soft 6,95 (claro) y 7,05 (oscuro, inset); accent 6,69 (claro) y 8,22 (oscuro); edge 3,97 (claro) y 3,73 (oscuro), justo. No se ha medido en el resto de casos de color (p. ej. pares de emparejar sobre su fondo).

**Objetivos táctiles:** 0 controles por debajo de 44×44 px en las 212 vistas (excepto `.word`, exento por DESIGN.md §6.3). Resultado: 10 controles, todos ≥ 44 px. Opciones de ejercicio 56 px.

**Foco con teclado:** en el ejercicio elegir, Tab lleva el foco a «Pinyin: Sí» → 一 → 二 → 三, en ese orden. El anillo es 3 px sólido `#17645F` (contraste 6,7:1 sobre la superficie). Tras fallar, el foco se queda en el contenedor principal (no salta al feedback; correcto con `aria-live`). Typing: sin anillo en HEAD (cambio 11).

**Foco en resultados:** no medido con Tab (solo ejercicio).

**aria-live:** feedback de lección, resultado, diccionario, typing, dibujo y estado de exportación de Anki: `role=status` o `aria-live=polite`. Caligrafía: el estado de descarga no tiene `aria-live` medido (`ws-hint`).

**Nombres accesibles de botones solo icono:** 0 en Inicio, Resultado, Ajustes (medido). Los `.dict-strokes` tienen `aria-label` «Trazos de X» (Diccionario). Los iconos de la barra tienen etiqueta visible.

**`lang` del hanzi:** Inicio (palabra del día) y lección: `zh-Hans` (medido 0 sin idioma). **Trazos (hoja): sin idioma** (P1-2). Diccionario `.dict-hanzi`: no medido (queda pendiente).

**`prefers-reduced-motion`:** el `animation` de los estados correcto/incorrecto queda en `none`, el borde y el fondo se conservan; la entrada de página dura 1e-6 s. Cumple DESIGN.md §5.

## 8. Rendimiento percibido

Medido con `Emulation.setCPUThrottlingRate(4)` y red simulada 4G (150 ms RTT, 1,6 Mbps de bajada), en perfil nuevo, Inicio:
- **Listo** (`html[data-ready=true]`) y **palabra del día** a la vez: **1,19 s**.
- **CLS:** 0,0045 (muy por debajo de 0,1).
- **Peticiones en Inicio:** 48. Los módulos ES se cargan sin empaquetar, así que hay cascada de peticiones. Fuente de `src/`: ~1 MB sin minificar.
- **Bytes transferidos:** no fiable. `transferSize` salió a 0 para JS y CSS; no doy cifra en KB. JSON de datos en Inicio: ~93 KB.
- **Tamaño del build:** `data/` 57 MB (incluye diccionario, cargado solo al abrirlo), `audio/` 5,8 MB, `fonts/` 44 KB.

Lectura: el arranque va bien en red móvil simulada. Lo que pesa es el diccionario y el audio; no los usa Inicio.

## 9. Lo que funciona y no hay que tocar

- **Inicio con progreso y sin progreso**: «Continuar: …» como único primario, palabra del día con hanzi en cuadrícula. Mantener.
- **Feedback de acierto y fallo**: iconos, texto y color, con `role=status`. Es el modelo para el resto de ejercicios.
- **Resultado**: «Repasar lo que fallé» primario, «Repetir» secundario, «Terminar» como texto. Mantener la jerarquía.
- **Repaso**: los cuatro modos con su línea de explicación (cambio 8). Mantener.
- **Vocabulario**: «Siguiente» arriba y «Añadir todas» como acción de lote.
- **Emparejar**: pares con número y color (no solo color), pinyin en cada ficha, y en fallo la lista completa de pares.
- **Ordenar**: fichas con pinyin, zona de respuesta punteada, «Comprobar» deshabilitado hasta tener algo.
- **Tokens y oscuro**: `light-dark()`, sin degradados, sin sombras de caída, sin `transition: all`. Los tonos ≥ 4,5:1 en fondo y superficie.
- **Barra inferior**: 6 pestañas, icono y etiqueta, 11 px, sin cortes en 320 px.
- **Conversación IA**: ajustes plegados por defecto y pasos numerados. Buen patrón para lo opcional.
- **Caligrafía (vista previa)**: cuadrícula punteada y trazos numerados. El estilo «Filas con orden de trazos» se lee.

## 10. Propuesta de tercera ronda (máximo 10, por rentabilidad)

| # | Cambio | Esfuerzo | Comando | Por qué primero |
|---|---|---|---|---|
| 1 | Hoja de trazos: `lang="zh-Hans"` en hanzi, glosa en es o etiqueta «en inglés», «tipos de trazo» plegado (P1-1, P1-2) | S | harden + clarify | Dos P1 en una sola pantalla, y es una de las que más se usan |
| 2 | Cuenta: texto sin `docs/SYNC.md` (P1-3) | S | clarify | Cambio de una línea en dos archivos de locale |
| 3 | Pinyin en la cabecera de ejercicio como `.chip` con borde y nombre propio (P2-4, P2-5) | S | clarify + harden | Es el interruptor que el principiante necesita en la primera lección |
| 4 | Aprender › Practica en dos grupos de ≤4 (P2-1) | S | layout | Cumple la checklist de chunking |
| 5 | Repaso vacío: ocultar modos sin tarjetas (P2-6) | S | onboard | Quita ruido en el estado vacío |
| 6 | Juegos: título «Juegos» y una línea por juego (P2-3, P2-12) | S | clarify | Encabezado falso y tres juegos sin explicación |
| 7 | Vocabulario: 4 filas + «Ver las 12 restantes» (P2-8) | M | distill | Quita el muro antes del primer ejercicio |
| 8 | Más: plegar «Herramientas avanzadas» (P2-2) | S | distill | 13 azulejos → 8 visibles |
| 9 | Plan 30 días: rejilla 2×2 y «Marcar» secundario (P2-9) | S | layout | Tarjeta dentro de tarjeta y botones de anchos distintos |
| 10 | Caligrafía: un solo primario, PDF como `.btn` (P2-10) | S | quieter | Dos primarios iguales confunden |

Antes de la ronda: **commitear `src/learn/typing.js`** (cambio 11, A6). Sin commit, el fallo sigue en HEAD.

## 11. Tres cosas que no conviene hacer

1. **No quitar el pinyin por defecto ni cambiar el hanzi por iconos.** Es lo que el principiante necesita, y el sistema ya lo resuelve con la cuadrícula. Los emblemas de los hubs son identidad (DESIGN.md §3), no decoración.
2. **No pasar las definiciones en español del diccionario a producción sin revisión humana.** El piloto de traducción (`docs/DICT-ES-PILOT.md`) existe para eso; la ronda 2 ya demostró que el inglés sin revisar se cuela en la interfaz.
3. **No añadir racha, puntos, confeti ni mascota para «animar» antes de cerrar P1 y P2-4.** Sigue siendo la advertencia de la ronda 2: decora un flujo que todavía no enseña del todo. Tampoco meter gradientes o sombras para dar «vida» a los hubs.

## 12. Contradicciones con docs/DESIGN.md

1. **§2 y §4 (Lecturas):** DESIGN.md dice «hairline row per reading»; el código usa tarjetas con chevron (`.card.field`). Sigue sin resolverse (P2 en la ronda 2, documentado en la verificación). Decidir: actualizar el documento o cambiar a filas.
2. **§3 (Tabla de tokens y `.chip`):** DESIGN.md describe el chip como toggle con `aria-pressed`, pero no fija nombre accesible. Los dos interruptores de Ajustes no tienen nombre propio (P2-5). No es contradicción formal, pero el documento debería pedirlo.
3. **§4 (Diccionario):** dice «hairline rows» con hanzi, pinyin, significados y acciones. Cada fila tiene además chips boxed de trazos (`.dict-strokes`) que el documento no menciona. Son parte de la sensación de «todo es caja».
4. **§3 y §4 (Trazos y hoja):** DESIGN.md pide la rejilla punteada. Se cumple en la hoja (medido `stroke-dasharray`), pero la hoja no marca el idioma de los hanzi (P1-2) ni cumple «interfaz en español» con la glosa (P1-1).
5. **§7 (Estado):** dice «Every Learn and More screen uses the tokens and shared classes». Cierto para las clases, pero la hoja de trazos y el texto de Cuenta mezclan inglés y rutas de desarrollo que no están en el sistema.

## 13. Notas de ejecución

- Build de HEAD `d09de8a` (no `e37f267` de VERIFICATION.md). El HEAD actual incluye commits posteriores de diccionario.
- `scripts/impeccable` no ejecutado (decisión local). `impeccable detect` no disponible: el «plantilla genérica» se midió con búsqueda en `src/`: 0 `gradient`, 0 `transition: all`, 0 `box-shadow` decorativo, 1 `outline: none` (`.screen`, contenedor de foco, justificado).
- 212 vistas automáticas y 33 capturas revisadas con visión (`vision_analyze`). El resto de capturas se contaron con el harness (sin fallos), no se miraron una a una.
- No se modificó código, datos ni tests. No se subió nada. No se instalaron dependencias.
