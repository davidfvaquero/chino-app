/**
 * anki.js — export/import of review cards in Anki's plain-text format.
 * Pure logic: no DOM. Persistence only through the storage API (src/storage.js)
 * via the deck in src/srs.js, so it runs in Node tests with an in-memory storage.
 *
 * File format (UTF-8, one card per line):
 *   #separator:tab
 *   #html:true
 *   #columns:Hanzi<TAB>Pinyin<TAB>Meaning<TAB>Example<TAB>Source<TAB>Tags
 *   你<TAB>nǐ<TAB>you<TAB><TAB>dict<TAB>hsk:1 detail:hsk1-lesson-01
 * A field containing TAB, a double quote or a line break is wrapped in "..."
 * with inner quotes doubled (""). & < > are written as HTML entities because
 * Anki reads fields as HTML; they are decoded again on import.
 *
 * Exports:
 *   ANKI_COLUMNS
 *   loadCards(db?, {source}?)        -> review-deck cards (optionally one source)
 *   sourcesOf(cards)                 -> sorted distinct source names
 *   exportCards(cards)               -> TSV string
 *   parseAnkiTsv(text)               -> { entries: [...], errors: [...] }
 *   previewImport(entries, db?)      -> { new, existing }
 *   importCards(entries, db?)        -> { added, skipped }   (dedupe by hanzi)
 *   exportFilename(ts?)              -> 'chino-anki-YYYY-MM-DD.tsv'
 *
 * Ceilings (deliberate): a line break inside a field becomes a space; Meaning
 * is split on ';', so a ';' inside one definition comes back as two.
 */
import storage from './storage.js';
import { createDeck } from './srs.js';
import { prettyPinyin, tonelessKey } from './pinyin.js';
import { localDayKey } from './day.js';

export const ANKI_COLUMNS = ['Hanzi', 'Pinyin', 'Meaning', 'Example', 'Source', 'Tags'];
const HEADER = ['#separator:tab', '#html:true', `#columns:${ANKI_COLUMNS.join('\t')}`];
const SEPARATORS = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' };

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeHtml = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
/** Import side: drop Anki's <br>/<b>… markup, then decode entities. */
const clean = (s) => unescapeHtml(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).trim();

function cell(value) {
  const text = escapeHtml(String(value ?? '')).replace(/[\r\n]+/g, ' ');
  return /[\t"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Card record -> the six Anki columns (raw values, not yet escaped). */
function toRow(card) {
  const detail = card.sourceDetail ? String(card.sourceDetail).replace(/\s+/g, '-') : '';
  const tags = [];
  const hsk = String(card.sourceDetail ?? '').match(/hsk(\d)/i);
  if (hsk) tags.push(`hsk:${hsk[1]}`);
  if (detail) tags.push(`detail:${detail}`);
  return [
    card.hanzi ?? card.simp ?? '',
    prettyPinyin(card.pinyin || card.pinyinNumeric || ''),
    (card.english ?? card.defs ?? []).join('; '),
    card.example ?? '',
    card.source || 'unknown',
    tags.join(' '),
  ];
}

/** Split one line on `sep`, honouring "quoted" cells (with "" as an escaped quote). */
export function splitRow(line, sep) {
  const cells = [];
  let i = 0;
  for (;;) {
    let value = '';
    if (line[i] === '"') {
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (line[i] === '"') {
          i += 1;
          break;
        } else {
          value += line[i];
          i += 1;
        }
      }
      while (i < line.length && line[i] !== sep) i += 1;
    } else {
      const next = line.indexOf(sep, i);
      const stop = next === -1 ? line.length : next;
      value = line.slice(i, stop);
      i = stop;
    }
    cells.push(value);
    if (i >= line.length) break;
    i += 1; // skip the separator
  }
  return cells;
}

/** Most frequent of tab ; , | in the line (tab wins ties and when none occur). */
export function detectSeparator(line) {
  const count = (ch) => line.split(ch).length - 1;
  const best = ['\t', ';', ',', '|'].reduce((a, b) => (count(b) > count(a) ? b : a));
  return count(best) ? best : '\t';
}

/** Export: header lines + one line per card. Empty list -> header only. */
export function exportCards(cards) {
  const rows = cards.map((card) => toRow(card).map(cell).join('\t'));
  return [...HEADER, ...rows].join('\n') + '\n';
}

/**
 * Parse Anki or app TSV/CSV text. Honours #separator:/#columns:, skips other
 * '#' directives and a header row (first cell "Hanzi"), and otherwise assumes
 * the default column order. Lines without a Hanzi are reported in `errors`.
 */
export function parseAnkiTsv(text) {
  const entries = [];
  const errors = [];
  let sep = null;
  let columns = null;

  String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;

    if (line.startsWith('#')) {
      const [key, ...rest] = line.slice(1).split(':');
      const value = rest.join(':').trim();
      if (key.trim().toLowerCase() === 'separator') {
        sep = SEPARATORS[value.toLowerCase()] ?? (value.length === 1 ? value : sep);
      } else if (key.trim().toLowerCase() === 'columns') {
        columns = splitRow(value, sep ?? '\t').map((c) => c.trim());
      }
      return;
    }

    if (sep === null) sep = detectSeparator(line);
    const cells = splitRow(line, sep).map((c) => c.trim());
    if (cells[0].toLowerCase() === 'hanzi') {
      columns ??= cells; // header row
      return;
    }

    const names = (columns ?? ANKI_COLUMNS).map((c) => c.toLowerCase());
    const get = (name) => {
      const i = names.indexOf(name);
      return i === -1 ? '' : clean(cells[i] ?? '');
    };
    const hanzi = get('hanzi');
    if (!hanzi) {
      errors.push(`line ${index + 1}: no Hanzi`);
      return;
    }

    const tags = get('tags').split(/\s+/);
    const detail = tags.find((t) => t.startsWith('detail:'))?.slice('detail:'.length);
    const hsk = tags.map((t) => t.match(/^hsk:?(\d)$/i)).find(Boolean);
    entries.push({
      hanzi,
      pinyin: prettyPinyin(get('pinyin')),
      english: get('meaning').split(';').map((s) => s.trim()).filter(Boolean),
      example: get('example'),
      source: get('source') || 'anki',
      sourceDetail: detail || (hsk ? `hsk${hsk[1]}` : null),
    });
  });

  return { entries, errors };
}

/** Review-deck cards, optionally only those of one source. */
export async function loadCards(db = storage, { source } = {}) {
  const cards = await createDeck(db).listCards();
  return source ? cards.filter((card) => (card.source || 'unknown') === source) : cards;
}

export function sourcesOf(cards) {
  return [...new Set(cards.map((card) => card.source || 'unknown'))].sort();
}

/** Dedup key: same hanzi AND same reading (了 le vs 了 liǎo are distinct). */
const entryKey = (hanzi, pinyin) => `${hanzi}\u0000${tonelessKey(pinyin || '')}`;

/** Splits entries into new ones and already-known ones (by hanzi + reading). */
async function planImport(entries, db) {
  const known = new Set((await loadCards(db)).map((card) => entryKey(card.hanzi ?? card.simp, card.pinyin || card.pinyinNumeric)));
  const fresh = [];
  let existing = 0;
  for (const entry of entries) {
    const key = entryKey(entry.hanzi, entry.pinyin);
    if (known.has(key)) existing += 1;
    else {
      known.add(key);
      fresh.push(entry);
    }
  }
  return { fresh, existing };
}

export async function previewImport(entries, db = storage) {
  const { fresh, existing } = await planImport(entries, db);
  return { new: fresh.length, existing };
}

/** Adds the new entries through the deck API (one duplicate rule). Example text is kept on the card. */
export async function importCards(entries, db = storage) {
  const { fresh } = await planImport(entries, db);
  const deck = createDeck(db);
  const { results } = await deck.addMany(fresh);
  let added = 0;
  for (const [index, entry] of fresh.entries()) {
    const { card, created } = results[index];
    if (!created) continue;
    if (entry.example) await db.set('srs', card.id, { ...card, example: entry.example });
    added += 1;
  }
  return { added, skipped: entries.length - added };
}

export function exportFilename(ts = Date.now()) {
  return `chino-anki-${localDayKey(new Date(ts))}.tsv`;
}
