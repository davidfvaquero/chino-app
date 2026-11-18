import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('/home/homelab/chino-app');
const RAW = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data', 'radicals');

const FORCE = process.env.FORCE === '1';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  const s = JSON.stringify(obj);
  fs.writeFileSync(file, s + '\n');
  return Buffer.byteLength(s);
}

async function cached(url, name) {
  ensureDir(RAW);
  const dest = path.join(RAW, name);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  console.log('  download', name, '<-', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

// ============================================================================
// 214 Kangxi Radicals Reference Data
// Source: Unicode Kangxi Radicals block (U+2F00–U+2FD5) + standard references
// ============================================================================
const KANGXI_RADICALS = [
  { number: 1, symbol: '一', pinyin: 'yī', meaning: 'one', strokes: 1 },
  { number: 2, symbol: '丨', pinyin: 'gǔn', meaning: 'line', strokes: 1 },
  { number: 3, symbol: '丶', pinyin: 'zhǔ', meaning: 'dot', strokes: 1 },
  { number: 4, symbol: '丿', pinyin: 'piě', meaning: 'slash', strokes: 1 },
  { number: 5, symbol: '乙', pinyin: 'yǐ', meaning: 'second', strokes: 1 },
  { number: 6, symbol: '亅', pinyin: 'jué', meaning: 'hook', strokes: 1 },
  { number: 7, symbol: '二', pinyin: 'èr', meaning: 'two', strokes: 2 },
  { number: 8, symbol: '亠', pinyin: 'tóu', meaning: 'lid', strokes: 2 },
  { number: 9, symbol: '人', pinyin: 'rén', meaning: 'person', strokes: 2 },
  { number: 10, symbol: '儿', pinyin: 'ér', meaning: 'child', strokes: 2 },
  { number: 11, symbol: '入', pinyin: 'rù', meaning: 'enter', strokes: 2 },
  { number: 12, symbol: '八', pinyin: 'bā', meaning: 'eight', strokes: 2 },
  { number: 13, symbol: '冂', pinyin: 'jiōng', meaning: 'wide', strokes: 2 },
  { number: 14, symbol: '冖', pinyin: 'mì', meaning: 'cover', strokes: 2 },
  { number: 15, symbol: '冫', pinyin: 'bīng', meaning: 'ice', strokes: 2 },
  { number: 16, symbol: '几', pinyin: 'jī', meaning: 'table', strokes: 2 },
  { number: 17, symbol: '凵', pinyin: 'kǎn', meaning: 'receptacle', strokes: 2 },
  { number: 18, symbol: '刀', pinyin: 'dāo', meaning: 'knife', strokes: 2 },
  { number: 19, symbol: '力', pinyin: 'lì', meaning: 'power', strokes: 2 },
  { number: 20, symbol: '勹', pinyin: 'bāo', meaning: 'wrap', strokes: 2 },
  { number: 21, symbol: '匕', pinyin: 'bǐ', meaning: 'spoon', strokes: 2 },
  { number: 22, symbol: '匚', pinyin: 'fāng', meaning: 'box', strokes: 2 },
  { number: 23, symbol: '匸', pinyin: 'xì', meaning: 'hiding enclosure', strokes: 2 },
  { number: 24, symbol: '十', pinyin: 'shí', meaning: 'ten', strokes: 2 },
  { number: 25, symbol: '卜', pinyin: 'bǔ', meaning: 'divination', strokes: 2 },
  { number: 26, symbol: '卩', pinyin: 'jié', meaning: 'seal', strokes: 2 },
  { number: 27, symbol: '厂', pinyin: 'hǎn', meaning: 'cliff', strokes: 2 },
  { number: 28, symbol: '厶', pinyin: 'sī', meaning: 'private', strokes: 2 },
  { number: 29, symbol: '又', pinyin: 'yòu', meaning: 'again', strokes: 2 },
  { number: 30, symbol: '口', pinyin: 'kǒu', meaning: 'mouth', strokes: 3 },
  { number: 31, symbol: '囗', pinyin: 'wéi', meaning: 'enclosure', strokes: 3 },
  { number: 32, symbol: '土', pinyin: 'tǔ', meaning: 'earth', strokes: 3 },
  { number: 33, symbol: '士', pinyin: 'shì', meaning: 'scholar', strokes: 3 },
  { number: 34, symbol: '夂', pinyin: 'zhǐ', meaning: 'go', strokes: 3 },
  { number: 35, symbol: '夊', pinyin: 'suī', meaning: 'walk slowly', strokes: 3 },
  { number: 36, symbol: '夕', pinyin: 'xī', meaning: 'evening', strokes: 3 },
  { number: 37, symbol: '大', pinyin: 'dà', meaning: 'big', strokes: 3 },
  { number: 38, symbol: '女', pinyin: 'nǚ', meaning: 'woman', strokes: 3 },
  { number: 39, symbol: '子', pinyin: 'zǐ', meaning: 'child', strokes: 3 },
  { number: 40, symbol: '宀', pinyin: 'mián', meaning: 'roof', strokes: 3 },
  { number: 41, symbol: '寸', pinyin: 'cùn', meaning: 'inch', strokes: 3 },
  { number: 42, symbol: '小', pinyin: 'xiǎo', meaning: 'small', strokes: 3 },
  { number: 43, symbol: '尢', pinyin: 'wāng', meaning: 'lame', strokes: 3 },
  { number: 44, symbol: '尸', pinyin: 'shī', meaning: 'corpse', strokes: 3 },
  { number: 45, symbol: '屮', pinyin: 'chè', meaning: 'sprout', strokes: 3 },
  { number: 46, symbol: '山', pinyin: 'shān', meaning: 'mountain', strokes: 3 },
  { number: 47, symbol: '巛', pinyin: 'chuān', meaning: 'river', strokes: 3 },
  { number: 48, symbol: '工', pinyin: 'gōng', meaning: 'work', strokes: 3 },
  { number: 49, symbol: '己', pinyin: 'jǐ', meaning: 'self', strokes: 3 },
  { number: 50, symbol: '巾', pinyin: 'jīn', meaning: 'towel', strokes: 3 },
  { number: 51, symbol: '干', pinyin: 'gān', meaning: 'dry', strokes: 3 },
  { number: 52, symbol: '幺', pinyin: 'yāo', meaning: 'tiny', strokes: 3 },
  { number: 53, symbol: '广', pinyin: 'guǎng', meaning: 'wide', strokes: 3 },
  { number: 54, symbol: '廴', pinyin: 'yǐn', meaning: 'walk', strokes: 3 },
  { number: 55, symbol: '廾', pinyin: 'gǒng', meaning: 'two hands', strokes: 3 },
  { number: 56, symbol: '弋', pinyin: 'yì', meaning: 'shoot', strokes: 3 },
  { number: 57, symbol: '弓', pinyin: 'gōng', meaning: 'bow', strokes: 3 },
  { number: 58, symbol: '彐', pinyin: 'jì', meaning: 'snout', strokes: 3 },
  { number: 59, symbol: '彡', pinyin: 'shān', meaning: 'hair', strokes: 3 },
  { number: 60, symbol: '彳', pinyin: 'chì', meaning: 'step', strokes: 3 },
  { number: 61, symbol: '心', pinyin: 'xīn', meaning: 'heart', strokes: 4 },
  { number: 62, symbol: '戈', pinyin: 'gē', meaning: 'halberd', strokes: 4 },
  { number: 63, symbol: '戶', pinyin: 'hù', meaning: 'door', strokes: 4 },
  { number: 64, symbol: '手', pinyin: 'shǒu', meaning: 'hand', strokes: 4 },
  { number: 65, symbol: '支', pinyin: 'zhī', meaning: 'branch', strokes: 4 },
  { number: 66, symbol: '攴', pinyin: 'pū', meaning: 'tap', strokes: 4 },
  { number: 67, symbol: '文', pinyin: 'wén', meaning: 'text', strokes: 4 },
  { number: 68, symbol: '斗', pinyin: 'dòu', meaning: 'dipper', strokes: 4 },
  { number: 69, symbol: '斤', pinyin: 'jīn', meaning: 'axe', strokes: 4 },
  { number: 70, symbol: '方', pinyin: 'fāng', meaning: 'square', strokes: 4 },
  { number: 71, symbol: '无', pinyin: 'wú', meaning: 'not', strokes: 4 },
  { number: 72, symbol: '日', pinyin: 'rì', meaning: 'sun', strokes: 4 },
  { number: 73, symbol: '曰', pinyin: 'yuē', meaning: 'say', strokes: 4 },
  { number: 74, symbol: '月', pinyin: 'yuè', meaning: 'moon', strokes: 4 },
  { number: 75, symbol: '木', pinyin: 'mù', meaning: 'tree', strokes: 4 },
  { number: 76, symbol: '欠', pinyin: 'qiàn', meaning: 'lack', strokes: 4 },
  { number: 77, symbol: '止', pinyin: 'zhǐ', meaning: 'stop', strokes: 4 },
  { number: 78, symbol: '歹', pinyin: 'dài', meaning: 'death', strokes: 4 },
  { number: 79, symbol: '殳', pinyin: 'shū', meaning: 'weapon', strokes: 4 },
  { number: 80, symbol: '毋', pinyin: 'wú', meaning: 'do not', strokes: 4 },
  { number: 81, symbol: '比', pinyin: 'bǐ', meaning: 'compare', strokes: 4 },
  { number: 82, symbol: '毛', pinyin: 'máo', meaning: 'fur', strokes: 4 },
  { number: 83, symbol: '氏', pinyin: 'shì', meaning: 'clan', strokes: 4 },
  { number: 84, symbol: '气', pinyin: 'qì', meaning: 'steam', strokes: 4 },
  { number: 85, symbol: '水', pinyin: 'shuǐ', meaning: 'water', strokes: 4 },
  { number: 86, symbol: '火', pinyin: 'huǒ', meaning: 'fire', strokes: 4 },
  { number: 87, symbol: '爪', pinyin: 'zhǎo', meaning: 'claw', strokes: 4 },
  { number: 88, symbol: '父', pinyin: 'fù', meaning: 'father', strokes: 4 },
  { number: 89, symbol: '爻', pinyin: 'yáo', meaning: 'mingle', strokes: 4 },
  { number: 90, symbol: '爿', pinyin: 'qiáng', meaning: 'split wood', strokes: 4 },
  { number: 91, symbol: '片', pinyin: 'piàn', meaning: 'slice', strokes: 4 },
  { number: 92, symbol: '牙', pinyin: 'yá', meaning: 'tooth', strokes: 4 },
  { number: 93, symbol: '牛', pinyin: 'niú', meaning: 'cow', strokes: 4 },
  { number: 94, symbol: '犬', pinyin: 'quǎn', meaning: 'dog', strokes: 4 },
  { number: 95, symbol: '玄', pinyin: 'xuán', meaning: 'profound', strokes: 5 },
  { number: 96, symbol: '玉', pinyin: 'yù', meaning: 'jade', strokes: 5 },
  { number: 97, symbol: '瓜', pinyin: 'guā', meaning: 'melon', strokes: 5 },
  { number: 98, symbol: '瓦', pinyin: 'wǎ', meaning: 'tile', strokes: 5 },
  { number: 99, symbol: '甘', pinyin: 'gān', meaning: 'sweet', strokes: 5 },
  { number: 100, symbol: '生', pinyin: 'shēng', meaning: 'life', strokes: 5 },
  { number: 101, symbol: '用', pinyin: 'yòng', meaning: 'use', strokes: 5 },
  { number: 102, symbol: '田', pinyin: 'tián', meaning: 'field', strokes: 5 },
  { number: 103, symbol: '疋', pinyin: 'pǐ', meaning: 'bolt of cloth', strokes: 5 },
  { number: 104, symbol: '疒', pinyin: 'nè', meaning: 'sickness', strokes: 5 },
  { number: 105, symbol: '癶', pinyin: 'bō', meaning: 'feet', strokes: 5 },
  { number: 106, symbol: '白', pinyin: 'bái', meaning: 'white', strokes: 5 },
  { number: 107, symbol: '皮', pinyin: 'pí', meaning: 'skin', strokes: 5 },
  { number: 108, symbol: '皿', pinyin: 'mǐn', meaning: 'vessel', strokes: 5 },
  { number: 109, symbol: '目', pinyin: 'mù', meaning: 'eye', strokes: 5 },
  { number: 110, symbol: '矛', pinyin: 'máo', meaning: 'spear', strokes: 5 },
  { number: 111, symbol: '矢', pinyin: 'shǐ', meaning: 'arrow', strokes: 5 },
  { number: 112, symbol: '石', pinyin: 'shí', meaning: 'stone', strokes: 5 },
  { number: 113, symbol: '示', pinyin: 'shì', meaning: 'spirit', strokes: 5 },
  { number: 114, symbol: '禸', pinyin: 'róu', meaning: 'track', strokes: 5 },
  { number: 115, symbol: '禾', pinyin: 'hé', meaning: 'grain', strokes: 5 },
  { number: 116, symbol: '穴', pinyin: 'xué', meaning: 'cave', strokes: 5 },
  { number: 117, symbol: '立', pinyin: 'lì', meaning: 'stand', strokes: 5 },
  { number: 118, symbol: '竹', pinyin: 'zhú', meaning: 'bamboo', strokes: 6 },
  { number: 119, symbol: '米', pinyin: 'mǐ', meaning: 'rice', strokes: 6 },
  { number: 120, symbol: '糸', pinyin: 'mì', meaning: 'silk', strokes: 6 },
  { number: 121, symbol: '缶', pinyin: 'fǒu', meaning: 'jar', strokes: 6 },
  { number: 122, symbol: '网', pinyin: 'wǎng', meaning: 'net', strokes: 6 },
  { number: 123, symbol: '羊', pinyin: 'yáng', meaning: 'sheep', strokes: 6 },
  { number: 124, symbol: '羽', pinyin: 'yǔ', meaning: 'feather', strokes: 6 },
  { number: 125, symbol: '老', pinyin: 'lǎo', meaning: 'old', strokes: 6 },
  { number: 126, symbol: '而', pinyin: 'ér', meaning: 'and', strokes: 6 },
  { number: 127, symbol: '耒', pinyin: 'lěi', meaning: 'plow', strokes: 6 },
  { number: 128, symbol: '耳', pinyin: 'ěr', meaning: 'ear', strokes: 6 },
  { number: 129, symbol: '聿', pinyin: 'yù', meaning: 'brush', strokes: 6 },
  { number: 130, symbol: '肉', pinyin: 'ròu', meaning: 'meat', strokes: 6 },
  { number: 131, symbol: '臣', pinyin: 'chén', meaning: 'minister', strokes: 6 },
  { number: 132, symbol: '自', pinyin: 'zì', meaning: 'self', strokes: 6 },
  { number: 133, symbol: '至', pinyin: 'zhì', meaning: 'reach', strokes: 6 },
  { number: 134, symbol: '臼', pinyin: 'jiù', meaning: 'mortar', strokes: 6 },
  { number: 135, symbol: '舌', pinyin: 'shé', meaning: 'tongue', strokes: 6 },
  { number: 136, symbol: '舛', pinyin: 'chuǎn', meaning: 'contrary', strokes: 6 },
  { number: 137, symbol: '舟', pinyin: 'zhōu', meaning: 'boat', strokes: 6 },
  { number: 138, symbol: '艮', pinyin: 'gèn', meaning: 'tough', strokes: 6 },
  { number: 139, symbol: '色', pinyin: 'sè', meaning: 'color', strokes: 6 },
  { number: 140, symbol: '艸', pinyin: 'cǎo', meaning: 'grass', strokes: 6 },
  { number: 141, symbol: '虍', pinyin: 'hū', meaning: 'tiger', strokes: 6 },
  { number: 142, symbol: '虫', pinyin: 'chóng', meaning: 'insect', strokes: 6 },
  { number: 143, symbol: '血', pinyin: 'xuè', meaning: 'blood', strokes: 6 },
  { number: 144, symbol: '行', pinyin: 'xíng', meaning: 'walk', strokes: 6 },
  { number: 145, symbol: '衣', pinyin: 'yī', meaning: 'clothes', strokes: 6 },
  { number: 146, symbol: '襾', pinyin: 'yà', meaning: 'cover', strokes: 6 },
  { number: 147, symbol: '見', pinyin: 'jiàn', meaning: 'see', strokes: 7 },
  { number: 148, symbol: '角', pinyin: 'jiǎo', meaning: 'horn', strokes: 7 },
  { number: 149, symbol: '言', pinyin: 'yán', meaning: 'speech', strokes: 7 },
  { number: 150, symbol: '谷', pinyin: 'gǔ', meaning: 'valley', strokes: 7 },
  { number: 151, symbol: '豆', pinyin: 'dòu', meaning: 'bean', strokes: 7 },
  { number: 152, symbol: '豕', pinyin: 'shǐ', meaning: 'pig', strokes: 7 },
  { number: 153, symbol: '豸', pinyin: 'zhì', meaning: 'beast', strokes: 7 },
  { number: 154, symbol: '貝', pinyin: 'bèi', meaning: 'shell', strokes: 7 },
  { number: 155, symbol: '赤', pinyin: 'chì', meaning: 'red', strokes: 7 },
  { number: 156, symbol: '走', pinyin: 'zǒu', meaning: 'walk', strokes: 7 },
  { number: 157, symbol: '足', pinyin: 'zú', meaning: 'foot', strokes: 7 },
  { number: 158, symbol: '身', pinyin: 'shēn', meaning: 'body', strokes: 7 },
  { number: 159, symbol: '車', pinyin: 'chē', meaning: 'cart', strokes: 7 },
  { number: 160, symbol: '辛', pinyin: 'xīn', meaning: 'bitter', strokes: 7 },
  { number: 161, symbol: '辰', pinyin: 'chén', meaning: 'morning', strokes: 7 },
  { number: 162, symbol: '辵', pinyin: 'chuò', meaning: 'walk', strokes: 7 },
  { number: 163, symbol: '邑', pinyin: 'yì', meaning: 'city', strokes: 7 },
  { number: 164, symbol: '酉', pinyin: 'yǒu', meaning: 'wine', strokes: 7 },
  { number: 165, symbol: '釆', pinyin: 'biàn', meaning: 'distinguish', strokes: 7 },
  { number: 166, symbol: '里', pinyin: 'lǐ', meaning: 'village', strokes: 7 },
  { number: 167, symbol: '金', pinyin: 'jīn', meaning: 'gold', strokes: 8 },
  { number: 168, symbol: '長', pinyin: 'cháng', meaning: 'long', strokes: 8 },
  { number: 169, symbol: '門', pinyin: 'mén', meaning: 'gate', strokes: 8 },
  { number: 170, symbol: '阜', pinyin: 'fù', meaning: 'mound', strokes: 8 },
  { number: 171, symbol: '隶', pinyin: 'lì', meaning: 'slave', strokes: 8 },
  { number: 172, symbol: '隹', pinyin: 'zhuī', meaning: 'bird', strokes: 8 },
  { number: 173, symbol: '雨', pinyin: 'yǔ', meaning: 'rain', strokes: 8 },
  { number: 174, symbol: '青', pinyin: 'qīng', meaning: 'blue', strokes: 8 },
  { number: 175, symbol: '非', pinyin: 'fēi', meaning: 'not', strokes: 8 },
  { number: 176, symbol: '面', pinyin: 'miàn', meaning: 'face', strokes: 9 },
  { number: 177, symbol: '革', pinyin: 'gé', meaning: 'leather', strokes: 9 },
  { number: 178, symbol: '韋', pinyin: 'wéi', meaning: 'leather', strokes: 9 },
  { number: 179, symbol: '韭', pinyin: 'jiǔ', meaning: 'leek', strokes: 9 },
  { number: 180, symbol: '音', pinyin: 'yīn', meaning: 'sound', strokes: 9 },
  { number: 181, symbol: '頁', pinyin: 'yè', meaning: 'leaf', strokes: 9 },
  { number: 182, symbol: '風', pinyin: 'fēng', meaning: 'wind', strokes: 9 },
  { number: 183, symbol: '飛', pinyin: 'fēi', meaning: 'fly', strokes: 9 },
  { number: 184, symbol: '食', pinyin: 'shí', meaning: 'food', strokes: 9 },
  { number: 185, symbol: '首', pinyin: 'shǒu', meaning: 'head', strokes: 9 },
  { number: 186, symbol: '香', pinyin: 'xiāng', meaning: 'fragrant', strokes: 9 },
  { number: 187, symbol: '馬', pinyin: 'mǎ', meaning: 'horse', strokes: 10 },
  { number: 188, symbol: '骨', pinyin: 'gǔ', meaning: 'bone', strokes: 10 },
  { number: 189, symbol: '高', pinyin: 'gāo', meaning: 'tall', strokes: 10 },
  { number: 190, symbol: '髟', pinyin: 'biāo', meaning: 'hair', strokes: 10 },
  { number: 191, symbol: '鬥', pinyin: 'dòu', meaning: 'fight', strokes: 10 },
  { number: 192, symbol: '鬯', pinyin: 'chàng', meaning: 'sacrificial wine', strokes: 10 },
  { number: 193, symbol: '鬲', pinyin: 'gé', meaning: 'cauldron', strokes: 10 },
  { number: 194, symbol: '鬼', pinyin: 'guǐ', meaning: 'ghost', strokes: 10 },
  { number: 195, symbol: '魚', pinyin: 'yú', meaning: 'fish', strokes: 11 },
  { number: 196, symbol: '鳥', pinyin: 'niǎo', meaning: 'bird', strokes: 11 },
  { number: 197, symbol: '鹵', pinyin: 'lǔ', meaning: 'salt', strokes: 11 },
  { number: 198, symbol: '鹿', pinyin: 'lù', meaning: 'deer', strokes: 11 },
  { number: 199, symbol: '麥', pinyin: 'mài', meaning: 'wheat', strokes: 11 },
  { number: 200, symbol: '麻', pinyin: 'má', meaning: 'hemp', strokes: 11 },
  { number: 201, symbol: '黃', pinyin: 'huáng', meaning: 'yellow', strokes: 11 },
  { number: 202, symbol: '黍', pinyin: 'shǔ', meaning: 'millet', strokes: 12 },
  { number: 203, symbol: '黑', pinyin: 'hēi', meaning: 'black', strokes: 12 },
  { number: 204, symbol: '黹', pinyin: 'zhǐ', meaning: 'embroidery', strokes: 12 },
  { number: 205, symbol: '黽', pinyin: 'miǎn', meaning: 'frog', strokes: 13 },
  { number: 206, symbol: '鼎', pinyin: 'dǐng', meaning: 'cauldron', strokes: 13 },
  { number: 207, symbol: '鼓', pinyin: 'gǔ', meaning: 'drum', strokes: 13 },
  { number: 208, symbol: '鼠', pinyin: 'shǔ', meaning: 'rat', strokes: 13 },
  { number: 209, symbol: '鼻', pinyin: 'bí', meaning: 'nose', strokes: 14 },
  { number: 210, symbol: '齊', pinyin: 'qí', meaning: 'even', strokes: 14 },
  { number: 211, symbol: '齒', pinyin: 'chǐ', meaning: 'teeth', strokes: 15 },
  { number: 212, symbol: '龍', pinyin: 'lóng', meaning: 'dragon', strokes: 16 },
  { number: 213, symbol: '龜', pinyin: 'guī', meaning: 'turtle', strokes: 16 },
  { number: 214, symbol: '龠', pinyin: 'yuè', meaning: 'flute', strokes: 17 },
];

// Map from radical symbol to Kangxi number (for quick lookup)
const RADICAL_TO_NUMBER = Object.fromEntries(KANGXI_RADICALS.map(r => [r.symbol, r.number]));

// Also include simplified variants that appear in the dictionary
const SIMPLIFIED_RADICAL_VARIANTS = {
  '⺀': '冫', '⺈': '丿', '⺊': '卜', '⺌': '小', '⺍': '小', '⺗': '心', '⺮': '竹', '⺳': '网',
  '氵': '水', '氺': '水', '灬': '火', '爫': '爪', '⺼': '肉', '忄': '心', '扌': '手', '攵': '攴',
  '礻': '示', '纟': '糸', '钅': '金', '衤': '衣', '讠': '言', '辶': '辵', '阝': '阜',
  '饣': '食', '頁': '頁', '風': '風', '飛': '飛', '馬': '馬', '鳥': '鳥', '魚': '魚',
  '麥': '麥', '黃': '黃', '黑': '黑', '龜': '龜', '龍': '龍',
  '见': '見', '车': '車', '门': '門', '长': '長', '页': '頁', '风': '風', '飞': '飛',
  '马': '馬', '鱼': '魚', '鸟': '鳥', '麦': '麥', '黄': '黃', '龟': '龜', '龙': '龍',
  '贝': '貝', '齐': '齊', '齿': '齒',
};

function normalizeRadical(rad) {
  // First check if it's a simplified variant mapping to a Kangxi radical
  if (SIMPLIFIED_RADICAL_VARIANTS[rad]) {
    return SIMPLIFIED_RADICAL_VARIANTS[rad];
  }
  return rad;
}

function getKangxiNumber(rad) {
  const norm = normalizeRadical(rad);
  return RADICAL_TO_NUMBER[norm] || null;
}

// ============================================================================
// IDS Decomposition parsing
// ============================================================================
// IDS operators: ⿰ (left-right), ⿱ (top-bottom), ⿲ (left-middle-right), ⿳ (top-middle-bottom),
// ⿴ (full surround), ⿵ (surround from above), ⿶ (surround from below), ⿷ (surround from left),
// ⿸ (surround from upper left), ⿹ (surround from upper right), ⿺ (surround from lower left),
// ⿻ (overlaid)
const IDS_OPS = new Set(['⿰','⿱','⿲','⿳','⿴','⿵','⿶','⿷','⿸','⿹','⿺','⿻']);

function parseDecomposition(ids) {
  if (!ids || ids === '？' || ids.startsWith('？')) return null;
  
  const parts = [];
  let i = 0;
  while (i < ids.length) {
    const ch = ids[i];
    if (IDS_OPS.has(ch)) {
      // operator, skip
      i++;
    } else {
      // component character
      parts.push(ch);
      i++;
    }
  }
  return parts.length > 0 ? parts : null;
}

// ============================================================================
// Simplified-only filter
// ============================================================================
// CC-CEDICT (public/data/dict/) lists every entry as {simp, trad}. A character
// that only ever shows up as the *traditional* form (trad, never simp) is not
// Simplified Chinese, so it must not appear in the radical grid. A character
// used by both forms (e.g. 好, 女) is kept.
function loadTraditionalOnly() {
  const dir = path.join(ROOT, 'public', 'data', 'dict', 'shards');
  const simp = new Set();
  const trad = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const entries = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const entry of entries) {
      if (entry.simp) for (const ch of entry.simp) simp.add(ch);
      if (entry.trad) for (const ch of entry.trad) trad.add(ch);
    }
  }
  const only = new Set();
  for (const ch of trad) if (!simp.has(ch)) only.add(ch);
  return only;
}

// ============================================================================
// Main build function
// ============================================================================
async function main() {
  console.log('Building radicals data...');
  const t0 = Date.now();
  
  // Clean output
  fs.rmSync(OUT, { recursive: true, force: true });
  ensureDir(OUT);
  ensureDir(path.join(OUT, 'shards'));
  
  // 1. Write radicals.json (the 214 Kangxi radicals)
  const radicalsOut = KANGXI_RADICALS.map(r => ({
    number: r.number,
    symbol: r.symbol,
    pinyin: r.pinyin,
    meaning: r.meaning,
    strokes: r.strokes,
  }));
  writeJson(path.join(OUT, 'radicals.json'), radicalsOut);
  console.log(`radicals.json: ${radicalsOut.length} radicals`);
  
  // 2. Load dictionary.txt from Make Me a Hanzi
  const dictFile = await cached(
    'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
    'dictionary.txt'
  );
  
  // 3. Load characters present in public/data
  const dataChars = new Set();
  const dataDirs = [
    path.join(ROOT, 'public', 'data', 'hsk'),
    path.join(ROOT, 'public', 'data', 'dict', 'shards'),
    path.join(ROOT, 'public', 'data', 'strokes'),
    path.join(ROOT, 'public', 'data', 'sentences', 'shards'),
    path.join(ROOT, 'public', 'data', 'readings'),
    path.join(ROOT, 'public', 'data', 'lessons'),
  ];
  
  for (const dir of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir, { recursive: true });
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        // Extract characters based on structure
        if (data.items) { // HSK
          for (const item of data.items) {
            for (const ch of item.hanzi) dataChars.add(ch);
          }
        } else if (Array.isArray(data)) { // dict shards, strokes shards, sentence shards, lesson vocab
          for (const item of data) {
            if (item.simp) { for (const ch of item.simp) dataChars.add(ch); }
            else if (item.character) { dataChars.add(item.character); }
            else if (item.zh) { for (const ch of item.zh) dataChars.add(ch); }
            else if (item.hanzi) { for (const ch of item.hanzi) dataChars.add(ch); }
            else if (item.vocab) {
              for (const v of item.vocab) { for (const ch of v.hanzi) dataChars.add(ch); }
            }
          }
        } else if (data.dialogue) { // readings
          for (const turn of data.dialogue) {
            for (const ch of turn.zh) dataChars.add(ch);
          }
        } else if (data.lookup) { // strokes index
          for (const ch of Object.keys(data.lookup)) dataChars.add(ch);
        }
      } catch {}
    }
  }
  
  console.log(`Characters in public/data: ${dataChars.size}`);
  
  // 4. Parse dictionary.txt for decomposition and radical data
  const dictText = fs.readFileSync(dictFile, 'utf8');
  const dictLines = dictText.split('\n').filter(Boolean);
  
  const decomposition = new Map(); // char -> { parts, radical, kangxiNumber }
  const reverseIndex = new Map(); // component -> Set(characters)
  let parsed = 0;
  
  for (const line of dictLines) {
    try {
      const o = JSON.parse(line);
      const ch = o.character;
      if (!ch || !dataChars.has(ch)) continue;
      
      const decomp = parseDecomposition(o.decomposition);
      const radical = o.radical;
      const kangxiNum = getKangxiNumber(radical);
      
      if (decomp || kangxiNum) {
        decomposition.set(ch, {
          parts: decomp || [],
          radical: radical,
          kangxiNumber: kangxiNum,
        });
        
        // Build reverse index
        const components = new Set();
        if (decomp) for (const p of decomp) components.add(p);
        if (radical) components.add(radical);
        // Also add normalized radical
        if (radical) components.add(normalizeRadical(radical));
        
        for (const comp of components) {
          if (!reverseIndex.has(comp)) reverseIndex.set(comp, new Set());
          reverseIndex.get(comp).add(ch);
        }
        
        parsed++;
      }
    } catch {}
  }
  
  console.log(`Characters with decomposition: ${parsed}`);
  
  // 5. Write decomposition shards by Unicode range
  const sortedChars = [...decomposition.keys()].sort();
  const shardSize = 500; // chars per shard
  const shards = [];
  
  for (let i = 0; i < sortedChars.length; i += shardSize) {
    const chunk = sortedChars.slice(i, i + shardSize);
    const shardData = {};
    for (const ch of chunk) {
      shardData[ch] = decomposition.get(ch);
    }
    const shardIdx = shards.length;
    const shardFile = `shards/${String(shardIdx).padStart(3, '0')}.json`;
    writeJson(path.join(OUT, shardFile), shardData);
    shards.push({
      file: shardFile,
      range: [chunk[0], chunk[chunk.length - 1]],
      count: chunk.length,
    });
  }
  
  // 6. Write decomposition index
  const decompIndex = {
    source: {
      name: 'Make Me a Hanzi',
      url: 'https://github.com/skishore/makemeahanzi',
      license: 'Arphic Public License / LGPL',
      homepage: 'https://github.com/skishore/makemeahanzi',
    },
    format: 'Each entry: {parts:[components], radical, kangxiNumber}. parts = immediate IDS components. kangxiNumber = 1-214 if radical maps to Kangxi radical.',
    characters: parsed,
    shards,
    shardFiles: shards.map(s => s.file),
  };
  writeJson(path.join(OUT, 'decomposition-index.json'), decompIndex);
  
  // 7. Write reverse index shards (by component)
  // Simplified-only: drop characters CC-CEDICT only knows as a traditional form
  // (媽 婦 嬰 …) so the radical grid never lists them. Components left with no
  // simplified character are dropped entirely.
  const tradOnly = loadTraditionalOnly();
  let droppedTrad = 0;
  for (const [comp, set] of reverseIndex) {
    for (const ch of [...set]) {
      if (tradOnly.has(ch)) { set.delete(ch); droppedTrad++; }
    }
    if (set.size === 0) reverseIndex.delete(comp);
  }
  console.log(`Reverse index: dropped ${droppedTrad} traditional-only characters`);

  const revComponents = [...reverseIndex.keys()].sort();
  const revShards = [];
  const revShardSize = 100;
  
  for (let i = 0; i < revComponents.length; i += revShardSize) {
    const chunk = revComponents.slice(i, i + revShardSize);
    const shardData = {};
    for (const comp of chunk) {
      // Sort: HSK characters first (we'd need HSK set, for now just sort)
      const chars = [...reverseIndex.get(comp)].sort();
      shardData[comp] = chars;
    }
    const shardIdx = revShards.length;
    const shardFile = `reverse-shards/${String(shardIdx).padStart(3, '0')}.json`;
    writeJson(path.join(OUT, shardFile), shardData);
    revShards.push({
      file: shardFile,
      range: [chunk[0], chunk[chunk.length - 1]],
      count: chunk.length,
    });
  }
  
  const reverseIndexMeta = {
    source: {
      name: 'Make Me a Hanzi',
      url: 'https://github.com/skishore/makemeahanzi',
      license: 'Arphic Public License / LGPL',
      homepage: 'https://github.com/skishore/makemeahanzi',
    },
    format: 'component -> [characters containing it]. Characters sorted by Unicode. Simplified only: CC-CEDICT traditional-only forms (trad never simp) are excluded. HSK priority not yet implemented.',
    components: revComponents.length,
    shards: revShards,
    shardFiles: revShards.map(s => s.file),
  };
  writeJson(path.join(OUT, 'reverse-index.json'), reverseIndexMeta);
  
  // 8. Write manifest
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else files.push({ file: path.relative(OUT, p), bytes: st.size });
    }
  }
  walk(OUT);
  files.sort((a, b) => (a.file < b.file ? -1 : 1));
  
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-radicals.mjs',
    sources: [
      {
        name: 'Make Me a Hanzi',
        url: 'https://github.com/skishore/makemeahanzi',
        license: 'Arphic Public License / LGPL',
        homepage: 'https://github.com/skishore/makemeahanzi',
        file: 'dictionary.txt',
      },
    ],
    sections: {
      radicals: { count: radicalsOut.length, file: 'radicals.json' },
      decomposition: { characters: parsed, shards: shards.length, files: decompIndex.shardFiles },
      reverseIndex: { components: revComponents.length, shards: revShards.length, files: reverseIndexMeta.shardFiles },
    },
    totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    fileCount: files.length,
    files,
  };
  writeJson(path.join(OUT, 'manifest.json'), manifest);
  writeJson(path.join(OUT, 'files.json'), files);
  
  console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${files.length} files, ${(manifest.totalBytes / 1024).toFixed(1)}KB`);
}

main().catch(err => { console.error('build-radicals failed:', err); process.exit(1); });