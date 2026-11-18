#!/usr/bin/env node
/**
 * check-es-data.mjs — validate the Spanish content translations.
 *
 * Convention (docs/i18n-content.md): English content lives in
 * `public/data/<path>.json`, its complete Spanish translation in
 * `public/data/es/<path>.json` — same structure, same keys, same ids.
 *
 * This script checks, for every Spanish file, against its English original:
 *   - exactly the same structure: same keys, same types, same array lengths;
 *   - non-translatable values identical (hanzi, pinyin, id, type, audio,
 *     speaker, tokens, *Key, numbers, booleans, pure-Chinese strings);
 *   - exercises still point at the right answer: for `options` + `answer`, the
 *     translated answer is the option at the SAME index (a numeric answer stays
 *     the same number);
 *   - no empty translatable string;
 *   - no missing accents / ñ in Spanish words that need them ("Anadir"), and
 *     questions/exclamations keep their opening sign ("¿Qué…?").
 *
 * Usage:
 *   node scripts/check-es-data.mjs                    # every public/data/es/**\/*.json
 *   node scripts/check-es-data.mjs lessons/hsk1       # only that file or directory
 *   node scripts/check-es-data.mjs --coverage         # list files with no translation
 *   node scripts/check-es-data.mjs --root <dir>       # fixture root instead of the repo
 *
 * Exit code: 1 when there is at least one error, 0 otherwise (`--coverage`
 * always exits 0 — it is information, not a gate).
 *
 * The pure parts (`validate`, `findAccentIssues`, `listUntranslated`) are
 * exported so tests/check-es-data.test.mjs can drive them without a filesystem.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fields that must never be translated (structure, ids, Chinese, audio…). */
const IDENTICAL_KEYS = new Set([
  'id',
  'type',
  'hanzi',
  'pinyin',
  'pinyinNumeric',
  'pinyinTone',
  'audio',
  'speaker',
  'tokens',
  'file',
  'url',
  'href',
  'level',
  'icon',
  'emoji',
  'tone',
  'count',
  'bytes',
  'source',
  'license',
  'homepage',
  'generatedAt',
  'generator',
]);

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_RE = /[A-Za-z]/;

/** Pure Chinese text (hanzi, punctuation, digits) — never translated. */
const isChinese = (text) => CJK_RE.test(text) && !LATIN_RE.test(text);

/** `hanzi`, `audio`, `promptKey`… are copied verbatim. */
const isIdenticalKey = (key) => IDENTICAL_KEYS.has(key) || /Key$/.test(key);

/** Spanish words that are always wrong without their accent (or ñ). */
const ACCENT_TYPOS = {
  anadir: 'añadir',
  anade: 'añade',
  anaden: 'añaden',
  anadiendo: 'añadiendo',
  anadido: 'añadido',
  anadida: 'añadida',
  espanol: 'español',
  espanola: 'española',
  leccion: 'lección',
  gramatica: 'gramática',
  numero: 'número',
  numeros: 'números',
  dias: 'días',
  dificil: 'difícil',
  facil: 'fácil',
  ingles: 'inglés',
  japones: 'japonés',
  frances: 'francés',
  despues: 'después',
  tambien: 'también',
  aqui: 'aquí',
  asi: 'así',
  oracion: 'oración',
  explicacion: 'explicación',
  informacion: 'información',
  traduccion: 'traducción',
  pronunciacion: 'pronunciación',
  opcion: 'opción',
  repeticion: 'repetición',
  pais: 'país',
  paises: 'países',
  rapido: 'rápido',
  ultimo: 'último',
  proximo: 'próximo',
  medico: 'médico',
  musica: 'música',
  telefono: 'teléfono',
  ningun: 'ningún',
  algun: 'algún',
  senor: 'señor',
  senora: 'señora',
  nino: 'niño',
  ninos: 'niños',
  nina: 'niña',
  ninas: 'niñas',
  anos: 'años',
  manana: 'mañana',
};

/** Words in `text` that look like Spanish written without accents. */
export function findAccentIssues(text) {
  const words = String(text).toLowerCase().match(/[a-zñ]+/g) ?? [];
  const fixes = words.filter((word) => ACCENT_TYPOS[word]).map((word) => `${word} -> ${ACCENT_TYPOS[word]}`);
  return [...new Set(fixes)];
}

/**
 * Compares one Spanish object against its English original.
 * Returns `[{ path, message }]` (empty array = valid). `path` is a JSON path
 * such as `$.exercises[0].answer`.
 */
export function validate(en, es) {
  const errors = [];
  walk(en, es, '$', errors);
  return errors;
}

function walk(en, es, at, errors) {
  const err = (message) => errors.push({ path: at, message });

  if (Array.isArray(en)) {
    if (!Array.isArray(es)) return err('tipo distinto: la traduccion no es una lista');
    if (en.length !== es.length) err(`la lista tiene ${es.length} elementos y el original ${en.length}`);
    for (let i = 0; i < Math.min(en.length, es.length); i += 1) walk(en[i], es[i], `${at}[${i}]`, errors);
    return;
  }

  if (en !== null && typeof en === 'object') {
    if (es === null || typeof es !== 'object' || Array.isArray(es)) {
      return err('tipo distinto: la traduccion no es un objeto');
    }
    for (const key of Object.keys(en)) if (!(key in es)) err(`falta la clave "${key}"`);
    for (const key of Object.keys(es)) if (!(key in en)) err(`clave de mas "${key}"`);
    for (const key of Object.keys(en)) if (key in es) walk(en[key], es[key], `${at}.${key}`, errors);
    checkAnswer(en, es, at, errors);
    return;
  }

  return scalar(en, es, at, errors);
}

function scalar(en, es, at, errors) {
  const err = (message) => errors.push({ path: at, message });
  const key = at.split('.').pop();

  if (typeof en !== typeof es) return err(`tipo distinto: ${typeof es} en vez de ${typeof en}`);
  if (en === null) return undefined;

  if (typeof en !== 'string') {
    // numbers, booleans: never translatable
    if (en !== es) err(`valor no traducible distinto: ${JSON.stringify(es)} en vez de ${JSON.stringify(en)}`);
    return undefined;
  }

  if (isIdenticalKey(key) || isChinese(en)) {
    if (en !== es) err(`campo no traducible distinto: "${es}" en vez de "${en}"`);
    return undefined;
  }

  if (es.trim() === '') {
    err('cadena traducible vacia');
    return undefined;
  }

  const accents = findAccentIssues(es);
  if (accents.length) err(`posible falta de acentos: ${accents.join(', ')}`);
  // Spanish opens questions and exclamations: "¿Qué significa…?" / "¡Hola!"
  if (en.includes('?') && !es.includes('¿')) err('falta el signo de apertura ¿ en la pregunta');
  if (es.includes('¿') !== es.includes('?')) err('signos de interrogacion descompensados (¿ ... ?)');
  if (es.includes('¡') !== es.includes('!')) err('signos de exclamacion descompensados (¡ ... !)');
  return undefined;
}

/**
 * The correct answer must still point at the same option. If the original
 * answer is one of the options (by value), the translated answer must be the
 * option at the SAME index of the translated list; a numeric answer (index)
 * must stay the same number.
 */
function checkAnswer(en, es, at, errors) {
  if (!Array.isArray(en.options) || !Array.isArray(es.options)) return;
  if (!('answer' in en) || !('answer' in es)) return;
  const err = (message) => errors.push({ path: `${at}.answer`, message });

  if (typeof en.answer === 'number') {
    if (es.answer !== en.answer) err(`el indice de la respuesta cambio: ${es.answer} en vez de ${en.answer}`);
    return;
  }
  if (typeof en.answer !== 'string') return;

  const index = en.options.indexOf(en.answer);
  if (index < 0) {
    if (!es.options.includes(es.answer)) err(`la respuesta "${es.answer}" no esta entre las opciones traducidas`);
    return;
  }
  const expected = es.options[index];
  if (es.answer !== expected) {
    err(`la respuesta "${es.answer}" deberia ser la opcion ${index} traducida ("${expected}")`);
  }
}

/* ------------------------------------------------------------------ files -- */

/** Machine-generated shards: never translated, so out of `--coverage`. */
const SKIP_DIRS = new Set(['dict', 'strokes', 'sentences', 'radicals', 'etymology']);
const SKIP_FILES = new Set(['files.json', 'manifest.json']);

async function isDir(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Every `*.json` under `dir`, as paths relative to `dir`. */
async function walkJson(dir, rel = '', out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walkJson(path.join(dir, entry.name), childRel, out);
    else if (entry.name.endsWith('.json')) out.push(childRel);
  }
  return out.sort();
}

/** English files (relative to public/data) that have no Spanish counterpart. */
export async function listUntranslated(enRoot, esRoot) {
  const files = await walkJson(enRoot);
  const missing = [];
  for (const rel of files) {
    const parts = rel.split('/');
    if (parts[0] === 'es') continue;
    if (parts.some((part) => SKIP_DIRS.has(part))) continue;
    if (SKIP_FILES.has(parts[parts.length - 1])) continue;
    if (!(await exists(path.join(esRoot, rel)))) missing.push(rel);
  }
  return missing;
}

/* -------------------------------------------------------------------- cli -- */

function parseArgs(argv) {
  const opts = { root: fileURLToPath(new URL('..', import.meta.url)), target: null, coverage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--coverage') opts.coverage = true;
    else if (arg === '--root') opts.root = path.resolve(argv[(i += 1)] ?? '.');
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (!arg.startsWith('-')) opts.target = arg;
  }
  return opts;
}

/** `lessons/hsk1` / `public/data/es/lessons` / an absolute path -> relative. */
function toRelative(target, { enRoot, esRoot }) {
  const raw = String(target).trim();
  if (path.isAbsolute(raw)) {
    const rel = path.relative(enRoot, raw);
    if (!rel.startsWith('..')) return rel.replace(/^es\//, '');
    throw new Error(`fuera de public/data: ${raw}`);
  }
  const cleaned = raw.replace(/^\.\//, '');
  if (/^(public\/)?data\/es\//.test(cleaned)) return cleaned.replace(/^(public\/)?data\/es\//, '');
  if (/^es\//.test(cleaned)) return cleaned.slice(3);
  if (/^(public\/)?data\//.test(cleaned)) return cleaned.replace(/^(public\/)?data\//, '');
  return cleaned;
}

async function targetsFor(opts, roots) {
  if (!opts.target) return walkJson(roots.esRoot);
  const rel = toRelative(opts.target, roots);
  const abs = path.join(roots.enRoot, rel);
  if (!(await exists(abs))) throw new Error(`no encuentro ${opts.target}`);
  if (!(await isDir(abs))) return [rel];
  const found = await walkJson(abs);
  return found.map((file) => `${rel}/${file}`.replace(/\/+/g, '/'));
}

const USAGE = `Uso: node scripts/check-es-data.mjs [<ruta-es-o-directorio>] [--coverage] [--root <dir>]`;

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const roots = {
    enRoot: path.join(opts.root, 'public', 'data'),
    esRoot: path.join(opts.root, 'public', 'data', 'es'),
  };

  if (opts.coverage) {
    const missing = await listUntranslated(roots.enRoot, roots.esRoot);
    const total = (await walkJson(roots.enRoot)).length;
    if (missing.length === 0) {
      console.log('check-es-data --coverage: todo el contenido tiene traduccion en es.');
    } else {
      console.log(`check-es-data --coverage: ${missing.length} archivos sin traduccion en public/data/es/:`);
      for (const rel of missing) console.log(`  - ${rel}`);
    }
    console.log(`(${total} archivos en public/data/, los shards generados no cuentan)`);
    return 0;
  }

  let targets;
  try {
    targets = await targetsFor(opts, roots);
  } catch (err) {
    console.error(`ERROR ${err.message}`);
    console.error(USAGE);
    return 1;
  }

  if (targets.length === 0) {
    console.log('check-es-data: no hay ningun archivo en public/data/es/ (nada que revisar).');
    return 0;
  }

  let errors = 0;
  for (const rel of targets) {
    const esFile = path.join(roots.esRoot, rel);
    const enFile = path.join(roots.enRoot, rel);
    const report = (jsonPath, message) => {
      errors += 1;
      console.log(`ERROR es/${rel} :: ${jsonPath} :: ${message}`);
    };

    if (!(await exists(esFile))) {
      report('$', 'no existe la traduccion (falta el archivo)');
      continue;
    }
    if (!(await exists(enFile))) {
      report('$', 'no existe el original en ingles');
      continue;
    }

    let en;
    let es;
    try {
      en = JSON.parse(await readFile(enFile, 'utf8'));
    } catch (err) {
      report('$', `JSON invalido en el original: ${err.message}`);
      continue;
    }
    try {
      es = JSON.parse(await readFile(esFile, 'utf8'));
    } catch (err) {
      report('$', `JSON invalido: ${err.message}`);
      continue;
    }

    for (const { path: jsonPath, message } of validate(en, es)) report(jsonPath, message);
  }

  console.log(`check-es-data: ${targets.length} archivos revisados, ${errors} errores.`);
  return errors === 0 ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = await main(process.argv.slice(2));
}
