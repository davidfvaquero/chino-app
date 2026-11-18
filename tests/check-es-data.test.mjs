/**
 * check-es-data.test.mjs — the Spanish content validator.
 *
 * Owner: t_4fa17334. Two layers:
 *   - unit: `validate(en, es)` on synthetic objects (the rules themselves);
 *   - end to end: the real CLI over a throwaway fixture tree (`--root`), so the
 *     exit code and the printed `archivo :: ruta :: mensaje` lines are checked.
 *
 * The fixture lives under os.tmpdir() (TMPDIR = the scratch dir); nothing here
 * touches public/data/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, findAccentIssues, listUntranslated } from '../scripts/check-es-data.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/check-es-data.mjs', import.meta.url));

/** Writes `{ 'public/data-relative path': object }` into a temp fixture root. */
async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'check-es-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, 'public', 'data', rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(content, null, 2));
  }
  return root;
}

const run = (root, ...args) =>
  spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });

const messages = (errors) => errors.map((e) => `${e.path} ${e.message}`).join(' | ');

const lesson = {
  id: 'hsk1-01',
  title: 'Greetings',
  vocabulary: [{ hanzi: '你', pinyin: 'nǐ', english: 'you', example: { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' } }],
  exercises: [
    { type: 'choose', prompt: 'What does 谢谢 mean?', options: ['thank you', 'goodbye'], answer: 'thank you' },
    { type: 'listen', audio: '你好', pinyin: 'nǐ hǎo', options: ['你好', '再见'], answer: '你好' },
    { type: 'order', prompt: "Make 'hello'.", tokens: ['好', '你'], answer: '你好' },
    { type: 'match', prompt: 'Match.', pairs: [{ hanzi: '你', english: 'you' }] },
  ],
};

const translated = {
  id: 'hsk1-01',
  title: 'Saludos',
  vocabulary: [{ hanzi: '你', pinyin: 'nǐ', english: 'tú', example: { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hola' } }],
  exercises: [
    { type: 'choose', prompt: '¿Qué significa 谢谢?', options: ['gracias', 'adiós'], answer: 'gracias' },
    { type: 'listen', audio: '你好', pinyin: 'nǐ hǎo', options: ['你好', '再见'], answer: '你好' },
    { type: 'order', prompt: "Forma 'hola'.", tokens: ['好', '你'], answer: '你好' },
    { type: 'match', prompt: 'Une cada palabra.', pairs: [{ hanzi: '你', english: 'tú' }] },
  ],
};

/* ------------------------------------------------------------------ rules -- */

test('a faithful translation has no errors', () => {
  assert.deepEqual(validate(lesson, translated), []);
});

test('a changed non-translatable field is an error (hanzi, pinyin, id, type, audio, tokens)', () => {
  const cases = [
    ['hanzi', (o) => (o.vocabulary[0].hanzi = '妳'), '$.vocabulary[0].hanzi'],
    ['pinyin', (o) => (o.vocabulary[0].pinyin = 'nǐ hao'), '$.vocabulary[0].pinyin'],
    ['id', (o) => (o.id = 'hsk1-99'), '$.id'],
    ['type', (o) => (o.exercises[0].type = 'order'), '$.exercises[0].type'],
    ['audio', (o) => (o.exercises[1].audio = '再见'), '$.exercises[1].audio'],
    ['tokens', (o) => (o.exercises[2].tokens = ['你', '好']), '$.exercises[2].tokens[0]'],
    ['answer (hanzi)', (o) => (o.exercises[2].answer = '好你'), '$.exercises[2].answer'],
  ];
  for (const [name, mutate, expectedPath] of cases) {
    const es = structuredClone(translated);
    mutate(es);
    const errors = validate(lesson, es);
    assert.equal(errors.length > 0, true, `${name} should fail`);
    assert.equal(
      errors.some((e) => e.path === expectedPath),
      true,
      `${name}: expected ${expectedPath}, got ${messages(errors)}`,
    );
  }
});

test('structure drift is an error (missing key, extra key, array length, type)', () => {
  const missing = structuredClone(translated);
  delete missing.title;
  assert.match(messages(validate(lesson, missing)), /falta la clave "title"/);

  const extra = structuredClone(translated);
  extra.subtitle = 'extra';
  assert.match(messages(validate(lesson, extra)), /clave de mas "subtitle"/);

  const short = structuredClone(translated);
  short.vocabulary.pop();
  assert.match(messages(validate(lesson, short)), /la lista tiene 0 elementos y el original 1/);

  const retyped = structuredClone(translated);
  retyped.exercises[0].options = { a: 'gracias' };
  assert.match(messages(validate(lesson, retyped)), /tipo distinto: la traduccion no es una lista/);
});

test('a choose answer pointing at the wrong option is an error', () => {
  const es = structuredClone(translated);
  es.exercises[0].answer = 'adiós'; // the original answers option 0
  const errors = validate(lesson, es);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, '$.exercises[0].answer');
  assert.match(errors[0].message, /opcion 0 traducida \("gracias"\)/);
});

test('options may be reordered as long as the answer follows the same index', () => {
  const es = structuredClone(translated);
  es.exercises[0].options = ['adiós', 'gracias'];
  es.exercises[0].answer = 'adiós';
  assert.deepEqual(validate(lesson, es), []);
});

test('a numeric answer index must stay the same number', () => {
  const en = { exercises: [{ type: 'choose', options: ['a', 'b', 'c'], answer: 2 }] };
  assert.deepEqual(validate(en, { exercises: [{ type: 'choose', options: ['x', 'y', 'z'], answer: 2 }] }), []);
  const errors = validate(en, { exercises: [{ type: 'choose', options: ['x', 'y', 'z'], answer: 0 }] });
  assert.match(messages(errors), /el indice de la respuesta cambio: 0 en vez de 2/);
});

test('an answer that is no longer among the options is an error', () => {
  const en = { exercises: [{ options: ['a', 'b'], answer: 'c' }] }; // answer not in the original options
  const errors = validate(en, { exercises: [{ options: ['x', 'y'], answer: 'z' }] });
  assert.match(messages(errors), /no esta entre las opciones traducidas/);
});

test('an empty translatable string is an error', () => {
  const es = structuredClone(translated);
  es.vocabulary[0].english = '   ';
  const errors = validate(lesson, es);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, '$.vocabulary[0].english');
  assert.match(errors[0].message, /cadena traducible vacia/);
});

test('a missing accent or ñ is an error ("Anadir", "leccion", "espanol")', () => {
  assert.deepEqual(findAccentIssues('Añadir una tarjeta'), []);
  assert.deepEqual(findAccentIssues('Anadir una leccion en espanol'), [
    'anadir -> añadir',
    'leccion -> lección',
    'espanol -> español',
  ]);

  const es = structuredClone(translated);
  es.exercises[0].prompt = 'Anade la traduccion correcta.';
  const errors = validate(lesson, es).filter((e) => /acentos/.test(e.message));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, '$.exercises[0].prompt');
  assert.match(errors[0].message, /anade -> añade/);
});

test('a question without ¿ (or an unbalanced ¡) is an error', () => {
  const en = { prompt: 'What does 谢谢 mean?', note: 'Goodbye!' };
  assert.deepEqual(validate(en, { prompt: '¿Qué significa 谢谢?', note: '¡Adiós!' }), []);

  const errors = validate(en, { prompt: 'Qué significa 谢谢?', note: 'Adiós!' });
  assert.match(messages(errors), /falta el signo de apertura ¿/);
  assert.match(messages(errors), /exclamacion descompensados/);

  const unbalanced = validate(en, { prompt: '¿Qué significa 谢谢?', note: '¡Adiós' });
  assert.match(messages(unbalanced), /exclamacion descompensados/);
});

test('i18n keys (*Key) and numbers are copied verbatim', () => {
  const en = { titleKey: 'tones.lesson.title', vocabulary: [{ hanzi: '妈', tone: 1, english: 'mother' }] };
  assert.deepEqual(validate(en, { titleKey: 'tones.lesson.title', vocabulary: [{ hanzi: '妈', tone: 1, english: 'madre' }] }), []);
  const errors = validate(en, { titleKey: 'tones.lesson.titulo', vocabulary: [{ hanzi: '妈', tone: 2, english: 'madre' }] });
  assert.match(messages(errors), /titleKey/);
  assert.match(messages(errors), /\$\.vocabulary\[0\]\.tone/);
});

/* -------------------------------------------------------------------- cli -- */

test('CLI: a valid pair exits 0', async () => {
  const root = await fixture({ 'lessons/hsk1/lesson-01.json': lesson, 'es/lessons/hsk1/lesson-01.json': translated });
  const result = run(root);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /1 archivos revisados, 0 errores/);
});

test('CLI: errors exit 1 and name the file and the JSON path', async () => {
  const broken = structuredClone(translated);
  broken.vocabulary[0].hanzi = '妳';
  broken.exercises[0].answer = 'adiós';
  const root = await fixture({ 'lessons/hsk1/lesson-01.json': lesson, 'es/lessons/hsk1/lesson-01.json': broken });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR es\/lessons\/hsk1\/lesson-01\.json :: \$\.vocabulary\[0\]\.hanzi/);
  assert.match(result.stdout, /ERROR es\/lessons\/hsk1\/lesson-01\.json :: \$\.exercises\[0\]\.answer/);
});

test('CLI: a missing translation is reported', async () => {
  const root = await fixture({ 'lessons/hsk1/lesson-01.json': lesson });
  const result = run(root, 'lessons/hsk1/lesson-01.json');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no existe la traduccion/);
});

test('CLI: a target can be a directory or the es path', async () => {
  const good = await fixture({ 'lessons/hsk1/lesson-01.json': lesson, 'es/lessons/hsk1/lesson-01.json': translated });
  assert.equal(run(good, 'public/data/es/lessons').status, 0);
  assert.equal(run(good, 'lessons/hsk1').status, 0);
  assert.equal(run(good, 'lessons').status, 0);

  const missing = run(good, 'lessons/nope');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no encuentro lessons\/nope/);
});

test('CLI: --coverage lists what has no translation and always exits 0', async () => {
  const root = await fixture({
    'lessons/hsk1/lesson-01.json': lesson,
    'es/lessons/hsk1/lesson-01.json': translated,
    'themes/theme-01.json': { id: 'theme-01', title: 'Greetings' },
    'dict/shards/000.json': [{ id: 1 }], // generated: not counted
  });
  const result = run(root, '--coverage');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 archivos sin traduccion/);
  assert.match(result.stdout, /- themes\/theme-01\.json/);
  assert.equal(result.stdout.includes('dict/shards/000.json'), false);
});

test('listUntranslated ignores generated shards and build listings', async () => {
  const root = await fixture({
    'lessons/hsk1/lesson-01.json': lesson,
    'es/lessons/hsk1/lesson-01.json': translated,
    'hsk/1.json': { level: 1 },
    'dict/index-hanzi.json': {},
    'files.json': [],
    'strokes/index.json': {},
  });
  const dataRoot = path.join(root, 'public', 'data');
  assert.deepEqual(await listUntranslated(dataRoot, path.join(dataRoot, 'es')), ['hsk/1.json']);
});
