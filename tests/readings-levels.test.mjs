// Multilevel readings — every committed `reading-NN.json` of hsk1/hsk2/hsk3 is
// validated against docs/reading-schema.md and the HSK vocabulary of its level
// (public/data/hsk/1..3.json). A reading whose file is not written yet is
// skipped: the index runs ahead of the content tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadIndex, loadReading, LEVELS, DEFAULT_LEVEL } from '../src/reading/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const READINGS = path.join(DATA, 'readings');

const HANZI = /[\u3400-\u9fff]/;
const LATIN = /[A-Za-z]/;

// --- Pinyin syllable counting (REVIEW-8 M6): a hanzi and a pinyin syllable
// must line up one to one, so a dropped syllable (很好玩 -> "Hěn wán") is
// caught. Count vowel nuclei; apostrophes/tones are stripped first. Two written
// exceptions keep the count fair and are spelled out (no magic allowlist):
//   - erhua: a 儿 that folds into the previous syllable's "r" (哪儿 nǎr);
//   - the reduced 一 of 看一看 (kànkan) and the phone-number 一 read yāo.
const stripTones = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const pinyinSyllables = (pinyin) =>
  (stripTones(pinyin).replace(/[.,!?;:，。！？；：、"'“”‘’「」（）()\-—…]/g, ' ')
    .match(/[aeiouü]+/gi) || []).length;
const erhuaCount = (hanzi, pinyin) => {
  const n = (hanzi.match(/儿/g) || []).length;
  return n ? Math.max(0, n - (pinyin.match(/ér/gi) || []).length) : 0;
};
const reducedYiCount = (hanzi, pinyin) => {
  const n = (hanzi.match(/一/g) || []).length;
  return n ? Math.max(0, n - (stripTones(pinyin).match(/yi|yao/gi) || []).length) : 0;
};
const expectedSyllables = (hanzi, pinyin) =>
  pinyinSyllables(pinyin) + erhuaCount(hanzi, pinyin) + reducedYiCount(hanzi, pinyin);

async function fileFetch(url) {
  const rel = url.replace(/^\/data\//, '');
  const text = await fs.promises.readFile(path.join(DATA, rel), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Allowed hanzi for a reading at `level`: HSK words of that level or lower. */
const hskChars = new Map();
for (let level = 1; level <= 3; level++) {
  const words = readJson(path.join(DATA, 'hsk', `${level}.json`)).items.map((item) => item.hanzi);
  hskChars.set(level, new Set([...(hskChars.get(level - 1) ?? []), ...words.join('')]));
}

/** Short allowlist: proper names that are not HSK vocabulary. */
const NAMES = new Set([...'王李华张伟美']);

/**
 * The 40 HSK1 readings predate this rule: they use 283 characters outside the
 * 150-word HSK1 list. Rewriting them is out of scope (HSK1 must stay as it is),
 * so their vocabulary is grandfathered here. New HSK1 files may only use HSK1
 * characters, plus this list — it never grows for new content.
 */
const LEGACY_HSK1 = new Set([...'两严为主久乐也事云亲以件休伞伟但体便信借假健傅元全公共养冒切初利别到加务动包匙半华单卡厅历发口只可史右司各合吧吹告员周咖咙哇哥唱啊啡啤喉嘴园图地堂复头奶如妹始姓它安完宜容密就尽山左希带帮常平床度康建弟张当录得微心忙快思息您愉意感愿慢房手才找报拿挂收故教文新方旁旅日早易晚晴最望末李条查检楼概次歌正步每汁汽法泳洗海消温游火炎烛烦烧然爬片牛物王玩班球瓶用留疼病痛白百直真着码碗礼祝离稍穿站等算篮粮糕糖紧累红纸线练给美者联肉肚胃脸舒色节药蓝蛋蜡表衫衬裙裤要订让议记许诉试课贵走赶足跑路踢身躺转边迎运近还进远退适通速酒重量钥铁错长门问间阳难零青非鞋音顺预题颜食餐饱饿馆鱼鸡麻'.split('')]);

const allowedFor = (level) => {
  const max = Number(String(level).replace('hsk', ''));
  return new Set([...hskChars.get(max), ...NAMES, ...(level === 'hsk1' ? LEGACY_HSK1 : [])]);
};

/* ------------------------------------------------------------- data.js -- */

test('the reader exposes hsk1..hsk3 and keeps the old single-argument loader', async () => {
  assert.deepEqual(LEVELS, ['hsk1', 'hsk2', 'hsk3']);
  assert.equal(DEFAULT_LEVEL, 'hsk1');
  const legacy = await loadIndex({ fetch: fileFetch });
  assert.equal(legacy.length, 40, 'loadIndex(opts) still reads hsk1');
  const hsk2 = await loadIndex('hsk2', { fetch: fileFetch });
  assert.equal(hsk2.length, 20);
  const one = await loadReading('reading-01', { level: 'hsk2', fetch: fileFetch });
  assert.equal(one.id, 'reading-01');
  assert.equal(one.topic, 'Shopping for clothes');
});

/* -------------------------------------------------------------- index --- */

for (const level of LEVELS) {
  test(`readings/${level}: the index pre-defines its readings with hanzi title and topic`, () => {
    const index = readJson(path.join(READINGS, level, 'index.json'));
    // hsk1 keeps its original 40; the new levels pre-define 20 each.
    assert.equal(index.length, level === 'hsk1' ? 40 : 20);
    index.forEach((entry, i) => {
      assert.equal(entry.id, `reading-${String(i + 1).padStart(2, '0')}`);
      assert.ok(HANZI.test(entry.title), `${entry.id}: title is hanzi`);
      assert.ok(entry.topic && !HANZI.test(entry.topic), `${entry.id}: topic is English`);
    });
  });
}

/* ------------------------------------------- schema + HSK vocabulary --- */

for (const level of LEVELS) {
  const dir = path.join(READINGS, level);
  const index = readJson(path.join(dir, 'index.json'));
  const allowed = allowedFor(level);

  for (const meta of index) {
    const file = path.join(dir, `${meta.id}.json`);
    const skip = !fs.existsSync(file);
    const opts = { skip, todo: skip ? 'reading not written yet' : undefined };

    test(`readings/${level}/${meta.id}: schema`, opts, () => {
      const raw = readJson(file);
      assert.equal(raw.id, meta.id, 'id matches the index and the file name');
      assert.equal(raw.title, meta.title, 'index title matches the reading');
      assert.equal(raw.topic, meta.topic, 'index topic matches the reading');
      assert.ok(['text', 'dialogue'].includes(raw.type), `type is text or dialogue (got ${raw.type})`);
      assert.ok(Array.isArray(raw.lines) && raw.lines.length > 0, 'has lines');
      for (const line of raw.lines) {
        for (const key of ['hanzi', 'pinyin', 'english']) {
          assert.ok(line[key], `${meta.id}: empty ${key}`);
        }
        assert.ok(HANZI.test(line.hanzi), `${meta.id}: no hanzi in "${line.hanzi}"`);
        if (raw.type === 'dialogue') assert.ok(line.speaker, `${meta.id}: dialogue line without a speaker`);
      }
    });

    test(`readings/${level}/${meta.id}: every character is HSK ${level.slice(3)} or lower`, opts, () => {
      const raw = readJson(file);
      const bad = new Set();
      for (const line of raw.lines) {
        for (const char of line.hanzi) {
          if (HANZI.test(char) && !allowed.has(char)) bad.add(char);
        }
      }
      assert.deepEqual([...bad], [], `${meta.id} uses characters outside HSK ${level.slice(3)}: ${[...bad].join('')}`);
    });

    test(`readings/${level}/${meta.id}: hanzi and pinyin syllables line up`, opts, () => {
      const raw = readJson(file);
      raw.lines.forEach((line, i) => {
        if (LATIN.test(line.hanzi)) return; // e.g. "WiFi密码": latin has no syllable
        const hanzi = [...line.hanzi].filter((c) => HANZI.test(c)).length;
        assert.equal(hanzi, expectedSyllables(line.hanzi, line.pinyin),
          `${meta.id} line ${i}: "${line.hanzi}" (${hanzi} hanzi) vs "${line.pinyin}"`);
      });
    });
  }
}
