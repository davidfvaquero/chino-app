/**
 * common.js — shared helpers for the games (matching, memory, timed).
 *
 * `loadWords(source)` resolves a word pool from one of the game sources:
 * 'hsk1' | 'review' | 'theme:<name>'. Kept in one place so the three games
 * cannot drift apart.
 */
import { search } from '../../dictionary.js';
import storage from '../../storage.js';
import { fetchData } from '../../data-url.js';

/** Words for a game source: the HSK1 list, the review deck, or a dictionary theme. */
export async function loadWords(source) {
  if (source === 'hsk1') {
    const data = await fetchData('hsk/1.json');
    return data.items ?? [];
  }
  if (source === 'review') {
    const list = await storage.list('srs');
    return list.map((row) => row.value).filter(Boolean);
  }
  if (source.startsWith('theme:')) {
    const theme = source.slice(6);
    const results = await search(theme, { limit: 50 });
    return results.map((r) => ({ hanzi: r.simp, pinyin: r.pinyinTone, english: r.defs }));
  }
  return [];
}
