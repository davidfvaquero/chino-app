// Shared, dependency-free logic for the Spanish dictionary pipeline.
//
// Used by scripts/dict-priority.mjs, scripts/translate-dict.mjs,
// scripts/validate-dict-es.mjs and tests/dict-es.test.mjs. Nothing here touches
// the network or the filesystem, so it is safe to import from tests.
//
// Marker glossary: CC-CEDICT definitions carry fixed English markers that must
// map to fixed Spanish words. ORDER MATTERS: the most specific marker wins, so
// "old variant of" is matched before "variant of" and "see also" before "see".

export const GLOSSARY = [
  ['old variant of', 'variante antigua de'],
  ['erhua variant of', 'variante erhua de'],
  ['variant of', 'variante de'],
  ['see also', 'véase también'],
  ['abbr. for', 'abreviatura de'],
  ['surname', 'apellido'],
  ['used in', 'se usa en'],
  ['Taiwan pr.', 'pronunciación en Taiwán'],
  ['also pr.', 'también se pronuncia'],
  ['CL:', 'clasificador:'],
  ['see', 'véase'],
  ['lit.', 'lit.'],
  ['fig.', 'fig.'],
  ['(slang)', '(coloquial)'],
  ['(dialect)', '(dialecto)'],
  ['(honorific)', '(honorífico)'],
  ['(Tw)', '(Taiwán)'],
  // Usage notes that leaked untranslated in the pilot (docs/DICT-ES-PILOT.md §3.4).
  // The rest are the 10 most frequent English parentheticals in priority.json.
  ['mostly used in given names', 'se usa mayormente en nombres propios'],
  ['mainly used in given names', 'se usa mayormente en nombres propios'],
  ['used as a surname and in given names', 'se usa como apellido y en nombres propios'],
  ['used as a surname, in given names or in place names', 'se usa como apellido, en nombres propios o en topónimos'],
  ['used as a surname', 'se usa como apellido'],
  ['(idiom)', '(modismo)'],
  ['(bird species of China)', '(especie de ave de China)'],
  ['(literary)', '(literario)'],
  ['(coll.)', '(coloquial)'],
  ['(loanword)', '(préstamo)'],
  ['(bound form)', '(forma ligada)'],
  ['(name)', '(nombre)'],
  ['(old)', '(antiguo)'],
  ['(math.)', '(mat.)'],
  ['(computing)', '(informática)'],
];

// Parenthetical usage notes, keyed by their bare English text: "(mostly used in
// given names)" -> "(se usa mayormente en nombres propios)". Derived from the
// glossary so there is a single source of truth for the prompt and the
// deterministic template pass.
const NOTE_ES = new Map(GLOSSARY.map(([en, es]) => [en.replace(/^\(|\)$/g, '').trim().toLowerCase(), es.replace(/^\(|\)$/g, '').trim()]));

// A parenthetical that legitimately reads the same in both languages.
const SAME_NOTE = new Set(['lit.', 'fig.']);

/** Re-translate the parenthetical usage notes of one definition. */
export function translateNotes(def) {
  return String(def ?? '').replace(/\(([^()]{1,80})\)/g, (whole, inner) => {
    const hit = NOTE_ES.get(inner.trim().toLowerCase());
    return hit ? `(${hit})` : whole;
  });
}

// English markers that occasionally survive into a Spanish definition (the LLM
// copied them or its own Spanish synonym did not match the glossary). Applied
// ONLY to repair already-translated defs, never during translation. Order
// matters: the longest marker first, and "CL:" collapses a double prefix.
const LEAK_FIXES = [
  [/CL:\s*clasificador:/g, 'clasificador:'],
  [/\(Tw\)/g, '(Taiwán)'],
  [/\bCL:\s*/g, 'clasificador: '],
  [/\bsee also\b/g, 'véase también'],
  [/\bvéanse también\b/g, 'véase también'],
  [/\berhua variant of\b/g, 'variante erhua de'],
  [/\bold variant of\b/g, 'variante antigua de'],
  [/\bantigua variante de\b/g, 'variante antigua de'],
  [/\bvariant of\b/g, 'variante de'],
  [/\babbr\. for\b/g, 'abreviatura de'],
  [/\babrev\./g, 'abreviatura'],
  [/\bTaiwan pr\./g, 'pronunciación en Taiwán'],
  [/\balso pr\./g, 'también se pronuncia'],
  [/\bpronunciación alternativa\b/g, 'también se pronuncia'],
  [/\bvéase también pronunciación\b/g, 'también se pronuncia'],
  // Word-order/word mistakes the LLM produced (REVIEW-2 I6): "Taiwán
  // pronunciación" instead of the glossary's "pronunciación en Taiwán", and the
  // French-looking "exprimer" for "ex primer" (ex-minister).
  [/Taiwán pronunciación/g, 'pronunciación en Taiwán'],
  [/\bexprimer\b/g, 'ex primer'],
  [/\(jerga\)/g, '(coloquial)'],
  [/\bsurname\b/g, 'apellido'],
  [/\bused in\b/g, 'se usa en'],
  // The marker "used in X" / "see X" pointing at a hanzi or bracketed pinyin:
  // normalise the idiomatic Spanish to the glossary wording the validator wants.
  [/\busad[oa] en\s+(?=[^\s]*[\u3400-\u9fff\uf900-\ufaff\[])/gu, 'se usa en '],
  [/\bver\s+(?=[^\s]*[\u3400-\u9fff\uf900-\ufaff\[])/gu, 'véase '],
];

/** Deterministic repair of one Spanish def: translate any English usage note or
 *  marker that leaked through. Pure text; leaves already-Spanish text alone. */
export function fixLeakedMarkers(def) {
  let out = translateNotes(def);
  for (const [re, to] of LEAK_FIXES) out = out.replace(re, to);
  return out;
}

// Markers that read the same in English and Spanish: never flag them as
// "untranslated english" when they survive the translation.
const SAME_ES = new Set(['lit.', 'fig.']);

// Validation table: [english marker, detector on the ENGLISH def, required core
// word in the SPANISH def]. The core word is a substring, not the full phrase,
// so "unofficial variant of" still satisfies "variante".
const HANZI_IN = '[\\u3400-\\u9fff\\uf900-\\ufaff]';
const MARKER_TESTS = [
  ['old variant of', /old variant of/, 'variante antigua'],
  ['erhua variant of', /erhua variant of/, 'variante erhua'],
  ['variant of', /variant of/, 'variante'],
  ['see also', /see also/, 'véase'],
  ['abbr. for', /abbr\. for/, 'abreviatura'],
  ['surname', /(^|\W)surname\s/, 'apellido'],
  ['used in', new RegExp(`used in\\s+\\S*(?:\\[|${HANZI_IN})`, 'u'), 'se usa en'],
  ['Taiwan pr.', /Taiwan pr\./, 'Taiwán'],
  ['also pr.', /also pr\./, 'también se pronuncia'],
  ['CL:', /CL:/, 'clasificador'],
  // "see" is a marker only when it points at an entry ("see 好[hao3]"); the verb
  // "to see" must not count.
  ['see', new RegExp(`see\\s+\\S*(?:\\[|${HANZI_IN})`, 'u'), 'véase'],
  ['lit.', /lit\./, 'lit.'],
  ['fig.', /fig\./, 'fig.'],
  ['(slang)', /\(slang\)/, 'coloquial'],
  ['(dialect)', /\(dialect\)/, 'dialecto'],
  ['(honorific)', /\(honorific\)/, 'honorífico'],
  ['(Tw)', /\(Tw\)/, 'Taiwán'],
];

const HANZI = /[\u3400-\u9fff\uf900-\ufaff]/g;
const BRACKET = /\[[^\]]+\]/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

/** Glossary markers present in one English definition, with the required
 *  Spanish core word (most specific first, so "old variant of" wins). */
export function markersIn(def) {
  const text = String(def ?? '');
  const out = [];
  for (const [enMarker, test, keyword] of MARKER_TESTS) {
    if (!test.test(text)) continue;
    if (enMarker === 'variant of' && (text.includes('old variant of') || text.includes('erhua variant of'))) continue;
    out.push([enMarker, keyword]);
  }
  return out;
}

/** Deterministic template translation of one "pure marker" definition. */
export function templateDefToEs(def) {
  const d = String(def ?? '');
  const note = (s) => translateNotes(s);
  if (/^surname\s+/.test(d)) return note(d.replace(/^surname\s+/, 'apellido '));
  if (/^old variant of\s+/.test(d)) return note(d.replace(/^old variant of\s+/, 'variante antigua de '));
  if (/^erhua variant of\s+/.test(d)) return note(d.replace(/^erhua variant of\s+/, 'variante erhua de '));
  if (/^variant of\s+/.test(d)) return note(d.replace(/^variant of\s+/, 'variante de '));
  if (/^CL:/.test(d)) return note(d.replace(/^CL:/, 'clasificador:'));
  return note(d);
}

/** Is a single definition a pure marker template (resolvable without the LLM)?
 *  Only a bare reference counts: "variant of 好[hao3]" / "CL:個|个[ge4]" /
 *  "surname Wang". A marker followed by a real gloss ("variant of 念[nian4],
 *  to read aloud") is NOT a template — it needs the LLM (REVIEW-2 I6). */
export function isTemplateDef(def) {
  return /^(surname|old variant of|erhua variant of|variant of|CL:)\s*\S+(\[[^\]]+\])?(\s*\([^)]*\))?$/.test(String(def ?? ''));
}

/** An entry is a "template" entry when EVERY one of its definitions is pure. */
export function classifyEntry(entry) {
  const defs = Array.isArray(entry && entry.defs) ? entry.defs : [];
  if (defs.length && defs.every(isTemplateDef)) return 'template';
  return null;
}

/** Translate a whole template entry without any network call. */
export function resolveTemplateDefs(defs) {
  return (defs || []).map(templateDefToEs);
}

/** Split a list into fixed-size batches. */
export function buildBatches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + size));
  return out;
}

/** Ids still to translate (idempotent resumption). */
export function computeToDo(ids, doneSet) {
  return ids.filter((id) => !doneSet.has(id));
}

/** Merge freshly translated entries into an existing shard list (fresh wins). */
export function mergeShardEntries(existing, fresh) {
  const byId = new Map();
  for (const e of existing || []) byId.set(e.id, e);
  for (const e of fresh || []) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Pull strict [{id, defs}] out of a model reply (tolerates a ```json fence). */
export function parseTranslation(text, expected) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `JSON inválido: ${err.message}` };
  }
  if (!Array.isArray(data)) return { ok: false, error: 'la respuesta no es una lista' };
  const byId = new Map();
  for (const item of data) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.defs)) {
      return { ok: false, error: 'item sin {id, defs:[...]}' };
    }
    byId.set(item.id, item);
  }
  const out = [];
  for (const en of expected) {
    const got = byId.get(en.id);
    if (!got) return { ok: false, error: `falta el id ${en.id}` };
    // Fewer defs than the English is allowed: rules 6/10 of the SYSTEM prompt
    // merge senses that share one Spanish term (e.g. ladybug/ladybird -> one
    // "mariquita (EE. UU. …, Reino Unido …)"). More defs is always a bug.
    if (got.defs.length > en.defs.length) {
      return { ok: false, error: `id ${en.id}: ${got.defs.length} defs > ${en.defs.length}` };
    }
    if (!got.defs.every((d) => typeof d === 'string' && d.trim())) {
      return { ok: false, error: `id ${en.id}: alguna def vacía` };
    }
    out.push({ id: en.id, defs: got.defs.map((d) => d.trim()) });
  }
  return { ok: true, entries: out };
}

const hanziTokens = (text) => String(text ?? '').match(HANZI) || [];
const bracketTokens = (text) => String(text ?? '').match(BRACKET) || [];

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u00ff]+/g, ' ')
    .trim();

/** A def that is only names / numbers / acronyms is fine to leave unchanged. */
const NAME_CONNECTORS = new Set(['of', 'and', 'the', 'de', 'del', 'la', 'los', 'las', 'y', 'e', 'et', 'for', 'in', 'on']);
const looksProper = (s) => {
  // Parenthetical qualifiers ("(Tire and Rubber Company)") are not part of the name.
  const t = String(s ?? '').replace(/\([^()]*\)/g, ' ').trim();
  if (!t) return true;
  if (!/[a-z]/.test(t)) return true; // digits, symbols, hanzi, acronyms
  return t.split(/\s+/).filter(Boolean).every((tk) =>
    /^[0-9]/.test(tk) || /^[\p{Lu}]/u.test(tk) || NAME_CONNECTORS.has(tk.toLowerCase().replace(/[^a-z]/gi, '')));
};

/** English function words — their presence in an unchanged def means a leak.
 *  Multi-letter only: a lone "A" (hepatitis A) or "a.m." is a legitimate label. */
const LEAK_FN = /(^|\s)(to|the|of|and|or|with|for|by|from|as|that|it|is|are|be|this|which|in|on|at|an)(\s|$)/;

/**
 * Validate one translated entry against its English original.
 * @returns {string[]} error messages (empty = ok)
 */
export function validateEntry(en, es) {
  const errs = [];
  if (!en || !es || typeof es !== 'object') return ['entrada ausente'];
  for (const d of es.defs || []) {
    if (typeof d === 'string' && CONTROL.test(d)) errs.push('carácter de control en una def');
  }
  if (!Array.isArray(es.defs)) return ['defs no es lista'];
  if (es.defs.length > en.defs.length) errs.push(`nº defs ${es.defs.length} > ${en.defs.length}`);
  es.defs.forEach((d, i) => {
    if (typeof d !== 'string' || !d.trim()) errs.push(`def ${i} vacía`);
    if (/<[a-z/][^>]*>/i.test(d)) errs.push(`def ${i} con tag raro`);
  });

  const esText = es.defs.join(' ');
  // Only defs that still have a Spanish counterpart must keep their hanzi /
  // bracketed pinyin: a def merged away (rules 6/10) legitimately drops them.
  // Compare on Unicode-normalised text (combining vs precomposed accents).
  const nfc = (s) => String(s ?? '').normalize('NFC');
  const esNorm = nfc(esText);
  const keptEnDefs = (en.defs || []).slice(0, es.defs.length);
  for (const t of [...new Set([...hanziTokens(keptEnDefs.join(' ')), ...bracketTokens(keptEnDefs.join(' '))])]) {
    if (!esNorm.includes(nfc(t))) errs.push(`falta preservar "${t}"`);
  }

  const seen = new Set();
  for (const def of en.defs || []) {
    for (const [enMarker, esMarker] of markersIn(def)) {
      if (seen.has(enMarker)) continue;
      seen.add(enMarker);
      // "lit."/"fig." read the same in both languages: whether the Spanish keeps
      // the abbreviation or spells it out, there is nothing to flag.
      if (SAME_ES.has(enMarker)) continue;
      if (!esText.includes(esMarker)) errs.push(`marcador "${enMarker}" no traducido a "${esMarker}"`);
      if (esText.includes(enMarker)) errs.push(`marcador inglés "${enMarker}" presente`);
    }
  }

  // Stray English/French words and the mangled Taiwan marker that the glossary
  // pass turns into Spanish (REVIEW-2 I6). fix-dict-es repairs both.
  if (/\bexprimer\b/.test(esText)) errs.push('palabra sin traducir "exprimer" (debe ser "ex primer")');
  if (/Taiwán pronunciación/.test(esText)) errs.push('marcador "Taiwán pronunciación" mal ordenado (debe ser "pronunciación en Taiwán")');

  en.defs.forEach((d, i) => {
    if (i >= es.defs.length) return; // merged away into an earlier def (rules 6/10)
    const sd = es.defs[i] || '';
    const nd = norm(d);
    // An identical string is an English leak only when it reads like an English
    // phrase: it carries an English function word. Cognates, interjections,
    // loanwords, proper names and Latin binomials survive translation legitimately.
    const leak = nd && nd === norm(sd) && !looksProper(sd) && LEAK_FN.test(` ${nd} `);
    if (leak) errs.push(`def ${i} idéntica al inglés (sin traducir)`);
    if (d.length >= 4 && es.defs.length >= en.defs.length) {
      // Very wide, advisory bands: they only catch a truncated or hallucinated
      // def, not the legitimate expansion/merge of a short English gloss. When a
      // def was merged away the index pairing is gone, so skip the ratio check.
      if (sd.length < Math.max(2, 0.12 * d.length - 2)) errs.push(`def ${i} demasiado corta (${sd.length} vs ${d.length})`);
      if (sd.length > 8 * d.length + 40) errs.push(`def ${i} demasiado larga (${sd.length} vs ${d.length})`);
    }
  });

  // §3.1 of DICT-ES-PILOT: the same Spanish term twice in one entry means two
  // senses were not differentiated nor merged into one definition.
  const seenDef = new Map();
  (es.defs || []).forEach((d, i) => {
    const k = norm(d);
    if (!k) return;
    if (seenDef.has(k)) errs.push(`def ${i} duplicada (igual que la def ${seenDef.get(k)})`);
    else seenDef.set(k, i);
  });
  return errs;
}

const PARENS = /\(([^()]{1,80})\)/g;
const parensOf = (s) => [...String(s ?? '').matchAll(PARENS)].map((m) => m[1].trim());

/**
 * Parenthetical usage notes still in English (§3.4). A warning, not an error:
 * a copied note can also be a proper name or a unit that reads the same.
 * @returns {string[]} warning messages
 */
export function parentheticalLeaks(en, es) {
  const out = [];
  const allowed = new Set([...SAME_NOTE, ...[...NOTE_ES.values()].map((s) => s.toLowerCase())]);
  (es.defs || []).forEach((d, i) => {
    const enParens = new Set(parensOf((en.defs || [])[i] || ''));
    for (const p of parensOf(d)) {
      const key = p.toLowerCase();
      if (!/[a-z]/i.test(p) || allowed.has(key)) continue;
      if (!enParens.has(p) && !NOTE_ES.has(key)) continue; // not an English note kept verbatim
      if (looksProper(p)) continue; // a latin name or proper noun reads the same
      if (/^[A-Z][a-z]+\s+[a-z]+\b/.test(p)) continue; // latin binomial (Ptyas mucosus)
      out.push(`nota parentética sin traducir: "(${p})"`);
    }
  });
  return out;
}

/** Lead of a translated marker def, so we can inspect what follows the reference. */
const MARKER_LEAD = /^(variante(?: antigua| erhua)? de|apellido|clasificador:|se usa en|véase(?: también)?|abreviatura de|también se pronuncia|pronunciación en Taiwán|se usa como)\b/u;

/**
 * An English gloss left after the hanzi/pinyin reference of a marker def, e.g.
 * "variante de 念[nian4], to read aloud" (REVIEW-2 I6). A WARNING: they need the
 * LLM to retranslate, so fix-dict-es lists them (scripts/dict-es-retranslate.json)
 * instead of guessing the Spanish. Detected by an English function word (or an
 * "and given name" tail) in the text after the first comma.
 * @returns {string[]} warning messages
 */
export function englishTailLeaks(en, es) {
  const out = [];
  (es.defs || []).forEach((d, i) => {
    if (!MARKER_LEAD.test(d)) return;
    const comma = d.search(/[,;]/);
    if (comma === -1) return;
    const tail = d.slice(comma + 1).trim();
    if (!/[a-z]/i.test(tail)) return;
    if (LEAK_FN.test(` ${norm(tail)} `) || /\band given name\b/.test(tail) || /^full name\b/.test(tail)) {
      out.push(`def ${i}: cola en inglés tras el marcador ("${tail.slice(0, 40)}")`);
    }
  });
  return out;
}

/** Rough token estimate from characters (4 chars ≈ 1 token) + per-entry overhead. */
export const estimateTokens = (chars, entries) => Math.ceil(chars / 4) + entries * 12;
/** Price per 1M tokens for deepseek/deepseek-v4.1-flash (OpenRouter, nov 2026). */
export const PRICE = { in: 0.3, out: 1.2 };

export const costUsd = (inTokens, outTokens, price = PRICE) =>
  (inTokens / 1e6) * price.in + (outTokens / 1e6) * price.out;
