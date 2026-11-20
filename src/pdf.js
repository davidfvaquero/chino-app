/**
 * pdf.js — minimal, dependency-free PDF writer (offline-first, no npm/CDN).
 *
 * Emits a PDF 1.4 file where every page is a single JPEG image embedded with
 * `/DCTDecode`. Chinese glyphs therefore render in ANY viewer without embedding
 * fonts: the screen renders each sheet page to a `<canvas>` at ~150 dpi
 * (src/extras/worksheet.js) and this module only wraps the JPEG bytes in the
 * PDF container (header, catalog, page tree, image + content streams, xref).
 *
 * Pure and browser-free: tests/pdf.test.mjs covers it.
 *
 * API:
 *   A4_WIDTH, A4_HEIGHT       -> 595.28, 841.89 (points, 72 dpi)
 *   fitImage(w, h)            -> {x,y,w,h} placement inside the A4 print box
 *   buildPdf(pages)           -> Uint8Array
 *     pages: [{ jpeg: Uint8Array, width: number, height: number }]
 *            one output PDF page per entry.
 */

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/** 1 cm (≈28.35 pt) margin around the printable box. */
export const PAGE_MARGIN = 28.35;

const encoder = new TextEncoder();

// "%PDF-1.4\n" + a binary marker line (4 bytes >127) so viewers treat it as binary.
const HEADER = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);

const trim = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Scale an image to fit the A4 printable box, keeping its aspect ratio.
 * Horizontally centred, anchored to the top.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function fitImage(imgW, imgH, pageW = A4_WIDTH, pageH = A4_HEIGHT, margin = PAGE_MARGIN) {
  const boxW = pageW - margin * 2;
  const boxH = pageH - margin * 2;
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: margin + (boxW - w) / 2, y: pageH - margin - h, w, h };
}

/**
 * Build a complete PDF file from page images.
 * @param {Array<{jpeg: Uint8Array, width: number, height: number}>} pages
 * @returns {Uint8Array}
 */
export function buildPdf(pages) {
  const list = (Array.isArray(pages) ? pages : []).filter(
    (p) => p && p.jpeg && p.jpeg.length && p.width > 0 && p.height > 0,
  );
  if (!list.length) throw new Error('buildPdf: at least one page image is required');

  // Object layout: 1 = catalog, 2 = page tree, then 3 objects per page
  // (image XObject, content stream, page).
  const objects = [];
  const kids = [];
  list.forEach((page, i) => {
    const imageId = 3 + i * 3;
    const contentId = imageId + 1;
    const pageId = imageId + 2;
    kids.push(pageId);

    objects[imageId] = {
      dict:
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      stream: page.jpeg,
    };

    const place = fitImage(page.width, page.height);
    const content =
      `q\n${trim(place.w)} 0 0 ${trim(place.h)} ${trim(place.x)} ${trim(place.y)} cm\n/Im0 Do\nQ\n`;
    objects[contentId] = { dict: `<< /Length ${content.length} >>`, stream: encoder.encode(content) };

    objects[pageId] = {
      dict:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}]` +
        ` /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    };
  });

  objects[1] = { dict: '<< /Type /Catalog /Pages 2 0 R >>' };
  objects[2] = {
    dict: `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${list.length} >>`,
  };

  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  push(HEADER);
  for (let id = 1; id < objects.length; id += 1) {
    const obj = objects[id];
    if (!obj) continue;
    offsets[id] = length;
    push(`${id} 0 obj\n${obj.dict}\n`);
    if (obj.stream) {
      push('stream\n');
      push(obj.stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  }

  const xrefOffset = length;
  const count = objects.length; // ids 1..count-1 (plus the free object 0)
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
