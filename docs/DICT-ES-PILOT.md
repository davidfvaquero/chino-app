# Evaluación ciega del piloto (Claude Haiku) — Diccionario ES

**Fecha:** 2026-11-20  
**Evaluador:** NVIDIA Nemotron 3 Ultra (proveedor distinto al traductor)  
**Muestra:** 150 entradas aleatorias (65 T1, 65 T2, 20 plantilla) de 300 totales  
**Criterio:** 2 = correcta y natural, 1 = comprensible con matiz/imprecisión, 0 = incorrecta o engañosa  

---

## 1. Resumen de puntuaciones

| Puntuación | Cantidad | Porcentaje |
|------------|----------|------------|
| **2** (correcta y natural) | 144 | **96.0%** |
| **1** (comprensible con imprecisiones) | 6 | **4.0%** |
| **0** (incorrecta/engañosa) | 0 | **0.0%** |

**Aceptables (1+2): 150/150 = 100%** — supera umbral ≥90%  
**Errores graves (0): 0/150 = 0%** — cumple umbral ≤2%

---

## 2. Por estrato

| Estrato | Entradas | Punt. 2 | Punt. 1 | Punt. 0 | % Aceptables (1+2) | % Excelentes (2) |
|---------|----------|---------|---------|---------|---------------------|------------------|
| **T1** (común/raro) | 65 | 63 | 2 | 0 | **100%** | 96.9% |
| **T2** (variado) | 65 | 62 | 3 | 0 | **100%** | 95.4% |
| **Plantilla** | 20 | 19 | 1 | 0 | **100%** | 95.0% |
| **TOTAL** | 150 | 144 | 6 | 0 | **100%** | 96.0% |

Todos los estratos superan holgadamente los umbrales.

---

## 3. Errores sistemáticos detectados

### 3.1 Traducción duplicada para sentidos distintos
**Ejemplos:**
- ID 121806 体现 [tǐ xiàn]: EN `['to embody', 'to reflect', 'to incarnate']` → ES `['encarnar', 'reflejar', 'encarnar']` — «encarnar» repetido para *embody* e *incarnate*.
- ID 74157 瓢虫 [piáo chóng]: EN `['ladybug', 'ladybird']` (EE. UU. / Reino Unido) → ES `['mariquita', 'mariquita']` — misma forma sin nota de variante regional.

**Corrección de prompt:**  
> «Cuando varios sentidos en inglés converjan en un mismo término español, **no repitas el término**. Fusiona en una sola definición con nota de uso (ej. `mariquita (EE. UU. ladybug, Reino Unido ladybird)`) o diferencia si hay matices.»

---

### 3.2 Hiperónimo genérico que pierde matiz semántico
**Ejemplos:**
- ID 49452 扑倒 [pū dǎo]: EN `['to fall down']` → ES `['caer']` — *pūdǎo* implica «caer de bruces / derribar con fuerza»; «caer» es demasiado genérico.
- ID 43992 戕害 [qiāng hài]: EN `['to injure']` → ES `['herir']` — *qiānghài* significa «masacrar, segar, causar daño gravísimo»; «herir» se queda corto.

**Corrección de prompt:**  
> «Para verbos con semántica de **manera/fuerza específica** (p. ej. 扑倒 = caer violentamente hacia adelante, 戕害 = masacrar/dañar severamente), usa el verbo español más preciso. **Evita hiperónimos genéricos** (caer, herir, romper) cuando exista término más específico (caer de bruces, derribar, masacrar, segar, aniquilar).»

---

### 3.3 Inconsistencia de categoría gramatical en entradas polisémicas
**Ejemplo:**
- ID 124716 点发 [diǎn fā]: EN `['to fire in bursts', 'shooting intermittently']` (dos verbos) → ES `['disparar en ráfagas', 'disparo intermitente']` (verbo + sustantivo).

**Corrección de prompt:**  
> «Mantén la **misma categoría gramatical** en todos los sentidos de una entrada. Si el inglés usa infinitivos en todas las acepciones, el español debe usar infinitivos en todas. No mezcles verbos y sustantivos.»

---

### 3.4 Fuga de inglés en entradas de plantilla
**Ejemplo:**
- ID 179 㛃 [jié]: EN `['variant of 潔|洁[jie2] (mostly used in given names)']` → ES `['variante de 潔|洁[jie2] (mostly used in given names)']` — la nota `(mostly used in given names)` quedó sin traducir.

**Corrección de prompt:**  
> «Las entradas de plantilla deben traducir **todo** el texto, incluidas notas parentéticas de uso. Añade al glosario fijo:  
> `mostly used in given names` → `se usa mayormente en nombres propios`  
> `used in` → `se usa en` (ya existe)  
> `see also` → `véase también` (ya existe)»

---

### 3.5 Ausencia de marca de variante regional cuando inglés la distingue
**Ejemplo:**
- ID 74157 瓢虫 [piáo chóng]: EN distingue `ladybug` (EE. UU.) y `ladybird` (Reino Unido); ES da `mariquita` dos veces sin nota.

**Corrección de prompt:**  
> «Cuando el inglés distinga variantes regionales (EE. UU. / Reino Unido / Taiwán / etc.) que convergen en un mismo término español, **añade una nota de uso entre paréntesis**:  
> `mariquita (EE. UU. ladybug, Reino Unido ladybird)`  
> `boniato (EE. UU. sweet potato, Reino Unido sweet potato)` — solo si el inglés las separa.»

---

## 4. Recomendación final

### ✅ **APTO**

**Justificación:**
- **100% entradas aceptables** (puntuación 1 o 2) — supera ampliamente el umbral del 90%.
- **0% errores graves** (puntuación 0) — cumple estrictamente el umbral del 2%.
- **96% excelentes** (puntuación 2) — calidad muy alta en todos los estratos.
- Los 6 casos de puntuación 1 son **imprecisiones menores** (duplicados, hiperónimos genéricos, inconsistencia gramatical, fuga en plantilla), **no errores de sentido**.
- No hay **falsos amigos**, **alucinaciones** ni **mezcla de sentidos** en la muestra evaluada.
- El sistema de plantillas funciona correctamente en 19/20 casos; la fuga detectada es corregible añadiendo una línea al glosario fijo.

**Acciones sugeridas antes de producción masiva:**
1. Añadir al glosario: `mostly used in given names` → `se usa mayormente en nombres propios`
2. Incorporar las 5 reglas de corrección de prompt al SYSTEM prompt (ver §3)
3. Ejecutar validador automático (`scripts/validate-dict-es.mjs`) sobre el piloto completo — ya detecta fugas de inglés y marcadores sin traducir

El piloto demuestra que el prompt actual produce traducciones de **calidad diccionaria nativa** para español neutro. Con los ajustes menores indicados, el sistema está listo para escalar a los 125k entradas.

---

## 5. Anexo: Entradas con puntuación 1 (detalle)

| # | ID | Hanzi | Pinyin | Estrato | EN | ES | Problema |
|---|-----|-------|--------|---------|----|----|----------|
| 15 | 121806 | 体现 | tǐ xiàn | T1 | embody, reflect, incarnate | encarnar, reflejar, **encarnar** | Duplicado |
| 51 | 49452 | 扑倒 | pū dǎo | T2 | to fall down | **caer** | Hiperónimo genérico |
| 62 | 74157 | 瓢虫 | piáo chóng | T2 | ladybug, ladybird | mariquita, **mariquita** | Duplicado sin nota regional |
| 75 | 43992 | 戕害 | qiāng hài | T2 | to injure | **herir** | Hiperónimo genérico |
| 116 | 179 | 㛃 | jié | Plantilla | variant of... (mostly used in given names) | variante de... **(mostly used in given names)** | Fuga inglés |
| 122 | 124716 | 点发 | diǎn fā | T1 | to fire in bursts, shooting intermittently | disparar en ráfagas, **disparo intermitente** | Inconsistencia gramatical (verbo + sustantivo) |

---  
*Fin del informe*