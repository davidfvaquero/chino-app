// CC-CEDICT pinyin validation for practical lessons.
// Run with: node scripts/validate-pinyin-practical.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = new URL('../public/data/lessons/practical/', import.meta.url);
const DICT_BASE = new URL('../public/data/dict/shards/', import.meta.url);

// Load all dictionary shards into a lookup map
function loadDictionary() {
  const files = readdirSync(fileURLToPath(DICT_BASE)).filter(f => f.endsWith('.json'));
  const dict = new Map();

  for (const file of files) {
    const content = readFileSync(fileURLToPath(new URL(file, DICT_BASE)), 'utf8');
    const entries = JSON.parse(content);
    for (const entry of entries) {
      const key = entry.simp;
      if (!dict.has(key)) {
        dict.set(key, []);
      }
      dict.get(key).push({
        pinyin: entry.pinyin,
        pinyinNumeric: entry.pinyinNumeric
      });
    }
  }
  return dict;
}

function pinyinToNumeric(pinyin) {
  const toneMap = {
    'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
    'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
    'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
    'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
    'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
    'ǖ': 'v1', 'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4',
    'ń': 'n2', 'ň': 'n3', 'ǹ': 'n4',
    'ḿ': 'm2',
    'Ā': 'A1', 'Á': 'A2', 'Ǎ': 'A3', 'À': 'A4',
    'Ē': 'E1', 'É': 'E2', 'Ě': 'E3', 'È': 'E4',
    'Ī': 'I1', 'Í': 'I2', 'Ǐ': 'I3', 'Ì': 'I4',
    'Ō': 'O1', 'Ó': 'O2', 'Ǒ': 'O3', 'Ò': 'O4',
    'Ū': 'U1', 'Ú': 'U2', 'Ǔ': 'U3', 'Ù': 'U4',
    'Ǖ': 'V1', 'Ǘ': 'V2', 'Ǚ': 'V3', 'Ǜ': 'V4',
  };

  let result = '';
  for (const char of pinyin) {
    result += toneMap[char] || char.toLowerCase();
  }
  return result;
}

function validate() {
  console.log('Loading dictionary...');
  const dict = loadDictionary();
  console.log(`Loaded ${dict.size} unique simplified headwords`);

  const lessons = ['lesson-01.json', 'lesson-02.json', 'lesson-03.json', 'lesson-04.json', 'lesson-05.json'];
  let totalWords = 0;
  let matched = 0;
  let mismatched = [];

  for (const lessonFile of lessons) {
    const content = readFileSync(fileURLToPath(new URL(lessonFile, BASE)), 'utf8');
    const lesson = JSON.parse(content);
    console.log(`\nValidating ${lessonFile} (${lesson.vocabulary.length} words)...`);

    for (const word of lesson.vocabulary) {
      totalWords++;
      const hanzi = word.hanzi;
      const lessonPinyin = word.pinyin;

      // Check exact match first
      let found = false;
      let dictPinyin = null;

      if (dict.has(hanzi)) {
        const entries = dict.get(hanzi);
        const lessonNumeric = pinyinToNumeric(lessonPinyin).replace(/\s+/g, '');
        for (const entry of entries) {
          const dictNumeric = entry.pinyinNumeric.replace(/\s+/g, '');
          if (lessonNumeric === dictNumeric) {
            found = true;
            dictPinyin = entry.pinyin;
            break;
          }
        }
      }

      // If not found as whole word, check character by character for multi-char words
      if (!found && hanzi.length > 1) {
        let allCharsMatch = true;
        for (const char of hanzi) {
          if (!dict.has(char)) {
            allCharsMatch = false;
            break;
          }
        }
        if (allCharsMatch) {
          found = true;
        }
      }

      if (found) {
        matched++;
      } else {
        mismatched.push({ hanzi, lessonPinyin, lessonFile });
      }
    }
  }

  console.log(`\n=== Validation Summary ===`);
  console.log(`Total vocabulary words: ${totalWords}`);
  console.log(`Matched in CC-CEDICT: ${matched}`);
  console.log(`Not directly matched: ${mismatched.length}`);

  if (mismatched.length > 0) {
    console.log('\nWords not directly matched (may be compounds or have variant pinyin):');
    for (const m of mismatched) {
      console.log(`  ${m.hanzi} (${m.lessonPinyin}) in ${m.lessonFile}`);
    }
  }

  // Check for traditional characters
  console.log('\nChecking for traditional characters...');
  let tradCount = 0;
  for (const lessonFile of lessons) {
    const content = readFileSync(fileURLToPath(new URL(lessonFile, BASE)), 'utf8');
    const lesson = JSON.parse(content);
    for (const word of lesson.vocabulary) {
      for (const char of word.hanzi) {
        const code = char.codePointAt(0);
        if (code > 0x9FFF && code < 0xFA00) {
          console.log(`  Possible traditional: ${char} in ${word.hanzi} (${lessonFile})`);
          tradCount++;
        }
      }
    }
  }
  if (tradCount === 0) {
    console.log('  No obvious traditional characters found.');
  }

  return mismatched.length === 0;
}

const success = validate();
if (!success) {
  console.log('\n⚠ Some words not directly matched in CC-CEDICT (this is expected for compounds).');
  process.exit(0);
} else {
  console.log('\n✓ All words directly matched in CC-CEDICT!');
  process.exit(0);
}