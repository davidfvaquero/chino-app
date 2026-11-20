/**
 * pdf.test.mjs — structure of the minimal PDF writer (src/pdf.js).
 * Browser-free: no canvas, no download; buildPdf only packs supplied bytes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { A4_WIDTH, A4_HEIGHT, PAGE_MARGIN, buildPdf, fitImage } from '../src/pdf.js';

const decoder = new TextDecoder();
const toText = (bytes) => decoder.decode(bytes);
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/** A fake but plausibly-shaped JPEG payload (SOI ... EOI). */
function fakeJpeg(seed = 0, size = 64) {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  for (let i = 3; i < size - 2; i += 1) bytes[i] = (i * 7 + seed) % 256;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

/** Read the xref table at `startxref` and return { offset, entries: number[] }. */
function readXref(bytes) {
  const text = latin1(bytes);
  const start = text.lastIndexOf('startxref');
  assert.ok(start >= 0, 'startxref present');
  const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  assert.ok(match, 'file ends with startxref + %%EOF');
  const offset = Number(match[1]);

  const slice = text.slice(offset);
  assert.ok(slice.startsWith('xref\n'), 'xref keyword at startxref offset');
  const header = /^xref\n(\d+) (\d+)\n/.exec(slice);
  assert.ok(header, 'xref subsection header');
  const first = Number(header[1]);
  const count = Number(header[2]);
  assert.equal(first, 0, 'subsection starts at object 0');

  const rows = [];
  let cursor = header[0].length;
  for (let i = 0; i < count; i += 1) {
    const row = slice.slice(cursor, cursor + 20);
    assert.match(row, /^\d{10} \d{5} [nf] \n$/, `xref row ${i} has the 20-byte form`);
    rows.push({ offset: Number(row.slice(0, 10)), type: row[17] });
    cursor += 20;
  }
  return { offset, rows, trailer: slice.slice(cursor) };
}

test('buildPdf emits a well-formed PDF with a correct xref table', () => {
  const pages = [
    { jpeg: fakeJpeg(1), width: 1240, height: 1754 },
    { jpeg: fakeJpeg(2), width: 1240, height: 1754 },
    { jpeg: fakeJpeg(3), width: 1240, height: 1754 },
  ];
  const bytes = buildPdf(pages);
  const text = latin1(bytes);

  assert.ok(text.startsWith('%PDF-1.4'), 'starts with %PDF-1.4');
  assert.ok(/\n%%EOF\s*$/.test(text), 'ends with %%EOF');

  const xref = readXref(bytes);
  assert.equal(xref.rows.length, 3 + 3 * pages.length, 'objects: free + catalog + tree + 3 per page');

  // Object 0 is the head of the free list.
  assert.equal(xref.rows[0].type, 'f');

  // Every in-use entry points exactly at "<id> 0 obj".
  for (let id = 1; id < xref.rows.length; id += 1) {
    assert.equal(xref.rows[id].type, 'n', `object ${id} is in use`);
    assert.ok(
      text.startsWith(`${id} 0 obj`, xref.rows[id].offset),
      `xref offset of object ${id} points at "<id> 0 obj"`,
    );
  }

  assert.match(xref.trailer, /\/Size \d+/, 'trailer has /Size');
  assert.match(xref.trailer, /\/Root 1 0 R/, 'trailer root is the catalog');
});

test('every page is A4 portrait (595x842 pt) with one JPEG image per page', () => {
  const pages = [
    { jpeg: fakeJpeg(1), width: 1240, height: 1754 },
    { jpeg: fakeJpeg(2), width: 600, height: 400 },
  ];
  const text = latin1(buildPdf(pages));

  const mediaBoxes = text.match(/\/MediaBox \[0 0 [\d.]+ [\d.]+\]/g) || [];
  assert.equal(mediaBoxes.length, pages.length, 'one MediaBox per page');
  for (const box of mediaBoxes) assert.equal(box, `/MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}]`);
  assert.equal(A4_WIDTH, 595.28);
  assert.equal(A4_HEIGHT, 841.89);

  const trees = text.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/);
  assert.ok(trees, '/Pages tree present');
  assert.equal(Number(trees[1]), pages.length, '/Count matches the page count');

  assert.equal((text.match(/\/Filter \/DCTDecode/g) || []).length, pages.length, 'one DCTDecode image per page');
});

test('image streams declare the exact /Length and are byte-identical to the input', () => {
  const jpeg = fakeJpeg(9, 128);
  const bytes = buildPdf([{ jpeg, width: 1240, height: 1754 }]);
  const text = latin1(bytes);

  const declared = Number(/\/Filter \/DCTDecode \/Length (\d+)/.exec(text)[1]);
  assert.equal(declared, jpeg.length, '/Length equals the JPEG byte count');

  // Bytes between "stream\n" and "\nendstream" for the image object (object 3).
  const marker = text.indexOf('stream\n');
  assert.ok(marker > 0, 'image stream present');
  const start = marker + 'stream\n'.length;
  const streamBytes = bytes.subarray(start, start + declared);
  assert.deepEqual(Array.from(streamBytes), Array.from(jpeg), 'stream bytes == input JPEG');
  assert.equal(text.slice(start + declared, start + declared + 10), '\nendstream');
});

test('buildPdf rejects an empty page list', () => {
  assert.throws(() => buildPdf([]), /at least one page/);
  assert.throws(() => buildPdf([{ jpeg: new Uint8Array(0), width: 10, height: 10 }]), /at least one page/);
});

test('fitImage scales into the A4 print box and keeps the aspect ratio', () => {
  const portrait = fitImage(1240, 1754);
  assert.ok(portrait.w <= A4_WIDTH - 2 * PAGE_MARGIN + 0.01);
  assert.ok(portrait.h <= A4_HEIGHT - 2 * PAGE_MARGIN + 0.01);
  const scale = portrait.w / portrait.h;
  assert.ok(Math.abs(scale - 1240 / 1754) < 1e-6, 'aspect ratio preserved');
  assert.equal(portrait.y + portrait.h, A4_HEIGHT - PAGE_MARGIN, 'top-anchored');

  const wide = fitImage(2000, 500);
  assert.ok(wide.w <= A4_WIDTH - 2 * PAGE_MARGIN + 0.01);
  assert.ok(Math.abs(wide.w / wide.h - 4) < 1e-6);
});
