/**
 * es-tokens.js — the one tokenizer shared by the Spanish search index builder
 * (scripts/build-dict-es-index.mjs) and the dictionary client (src/dictionary.js).
 * A rebuild and a query must agree on what counts as a word, or the index keys
 * never match the client's tokens.
 *
 * Reference markup is stripped first: CC-CEDICT definitions carry pinyin in
 * brackets and hanzi|hanzi variant references — "clasificador:家[jia1]",
 * "véase 謀取|谋取[mou2 qu3]" — whose syllables are not Spanish words. Indexing
 * them used to make "wo"/"jia" surface random entries instead of 我/家
 * (REVIEW-3 I5/I6).
 */

/** High-frequency words that carry no meaning on their own. */
export const ES_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a',
  'y', 'e', 'o', 'u', 'ni', 'que', 'se', 'su', 'sus', 'le', 'les', 'lo', 'es',
  'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'como', 'mas', 'más',
  'muy', 'no', 'si', 'sí', 'ya', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
  'esos', 'esas', 'aquel', 'aquella', 'uno', 'dos', 'tres', 'usar', 'hacer',
  'ser', 'estar', 'tener', 'algo', 'alguien', 'otro', 'otra', 'mismo', 'misma',
  'tal', 'cual', 'donde', 'cuando', 'porque', 'hacia', 'hasta', 'desde', 'según',
  'segun', 'también', 'tambien', 'solo', 'sólo', 'poco', 'muy', 'tan', 'tanto',
]);

/** Drop pinyin brackets (with the hanzi glued to them) and hanzi|hanzi refs. */
const REFERENCE_RE = /\S*\[[^\]]*\]/g;
const VARIANT_RE = /[\u3400-\u9fff\uf900-\ufaff]+\|[\u3400-\u9fff\uf900-\ufaff]+/g;

/** Lowercase, accent-stripped tokens of a text (ñ -> n, ü -> u), references gone. */
export function esTokens(text) {
  const clean = String(text ?? '')
    .replace(REFERENCE_RE, ' ')
    .replace(VARIANT_RE, ' ');
  return clean
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z]+/g) || [];
}
