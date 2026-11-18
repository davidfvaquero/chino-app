#!/usr/bin/env node
// Validate lessons 2-5 against schema and word ranges.
// Moved here from the repo root (t_d10b8bf7); paths are relative to scripts/.
// Run from the repo root:  node scripts/validate-lessons.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadIndex, loadLesson } from '../src/learn/lessons.js';

import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = new URL('file://' + resolve(ROOT, 'public/data/lessons/') + '/');
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

// Load HSK1 word list
const hsk1Data = JSON.parse(readFileSync(resolve(ROOT, 'public/data/hsk/1.json'), 'utf8'));
const hsk1Words = hsk1Data.items;

async function validateLesson(lessonId, expectedRange) {
  console.log(`\n=== Validating ${lessonId} ===`);
  
  const lesson = await loadLesson('hsk1', lessonId, opts);
  
  // Check basic structure
  console.log(`ID: ${lesson.id}`);
  console.log(`Title: ${lesson.title}`);
  console.log(`Vocabulary count: ${lesson.vocabulary.length}`);
  console.log(`Exercises count: ${lesson.exercises.length}`);
  console.log(`Intro: ${lesson.intro}`);
  
  // Check vocabulary entries have all required fields
  for (const word of lesson.vocabulary) {
    if (!word.hanzi || !word.pinyin || !word.english) {
      throw new Error(`Missing required field in vocabulary: ${JSON.stringify(word)}`);
    }
  }
  
  // Check exercises have valid types
  const validTypes = ['choose', 'listen', 'match', 'order'];
  for (const ex of lesson.exercises) {
    if (!validTypes.includes(ex.type)) {
      throw new Error(`Invalid exercise type: ${ex.type}`);
    }
    if (!ex.prompt) {
      throw new Error(`Exercise missing prompt: ${JSON.stringify(ex)}`);
    }
  }
  
  // Check word range coverage
  const expectedWords = hsk1Words.slice(expectedRange.from - 1, expectedRange.to);
  const lessonHanzi = lesson.vocabulary.map(w => w.hanzi);
  const expectedHanzi = expectedWords.map(w => w.hanzi);
  
  console.log(`Expected words (${expectedRange.from}-${expectedRange.to}): ${expectedHanzi.join(', ')}`);
  console.log(`Lesson words: ${lessonHanzi.join(', ')}`);
  
  const missing = expectedHanzi.filter(h => !lessonHanzi.includes(h));
  const extra = lessonHanzi.filter(h => !expectedHanzi.includes(h));
  
  if (missing.length > 0) {
    throw new Error(`Missing words from range: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    console.log(`WARNING: Extra words not in range: ${extra.join(', ')}`);
  }
  
  // Check pinyin matches HSK1 data
  for (const word of lesson.vocabulary) {
    const hsk1Entry = hsk1Words.find(w => w.hanzi === word.hanzi);
    if (hsk1Entry && hsk1Entry.pinyin !== word.pinyin) {
      console.log(`WARNING: Pinyin mismatch for ${word.hanzi}: HSK1 has "${hsk1Entry.pinyin}", lesson has "${word.pinyin}"`);
    }
  }
  
  // Test grading each exercise with correct answer
  const { gradeExercise } = await import('../src/learn/exercises.js');
  for (const ex of lesson.exercises) {
    let response;
    if (ex.type === 'match') {
      response = Object.fromEntries(ex.pairs.map(p => [p.hanzi, p.english]));
    } else if (ex.type === 'order') {
      response = Array.isArray(ex.answer) ? ex.answer : ex.answer.split('');
    } else {
      response = ex.answer;
    }
    const result = gradeExercise(ex, response);
    if (!result.correct) {
      throw new Error(`Exercise "${ex.prompt}" failed grading with correct answer`);
    }
  }
  
  console.log(`✓ ${lessonId} validation passed`);
  return true;
}

async function main() {
  const index = await loadIndex('hsk1', opts);
  const lessons = index.lessons.filter(l => ['hsk1-02', 'hsk1-03', 'hsk1-04', 'hsk1-05'].includes(l.id));
  
  for (const lesson of lessons) {
    await validateLesson(lesson.id, lesson.range);
  }
  
  console.log('\n=== ALL LESSONS VALIDATED ===');
}

main().catch(e => {
  console.error('Validation failed:', e.message);
  process.exit(1);
});
