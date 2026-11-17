/**
 * Generates the PWA icons (simple rounded "中" glyph) with no dependencies.
 * Run with `npm run icons`; output goes to public/icons and is committed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { encodePng } from './png.mjs';

const BG = [0xb3, 0x26, 0x1e, 0xff];
const FG = [0xff, 0xff, 0xff, 0xff];

function paint(size, padding) {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) rgba.set(BG, i * 4);

  const inner = size * (1 - 2 * padding);
  const left = size * padding;
  const top = size * padding;
  const w = inner;
  const h = inner;
  const t = Math.max(1, Math.round(w * 0.1));

  const rect = (x0, y0, x1, y1) => {
    const [xa, xb] = [Math.round(x0), Math.round(x1)].sort((a, b) => a - b);
    const [ya, yb] = [Math.round(y0), Math.round(y1)].sort((a, b) => a - b);
    for (let y = Math.max(0, ya); y < Math.min(size, yb); y += 1) {
      for (let x = Math.max(0, xa); x < Math.min(size, xb); x += 1) rgba.set(FG, (y * size + x) * 4);
    }
  };

  const cx = left + w / 2;
  // vertical stroke of 中
  rect(cx - t / 2, top + h * 0.04, cx + t / 2, top + h * 0.96);
  // box of 中
  const bx0 = left + w * 0.18;
  const bx1 = left + w * 0.82;
  const by0 = top + h * 0.3;
  const by1 = top + h * 0.72;
  rect(bx0, by0, bx1, by0 + t);
  rect(bx0, by1 - t, bx1, by1);
  rect(bx0, by0, bx0 + t, by1);
  rect(bx1 - t, by0, bx1, by1);
  return encodePng(size, size, rgba);
}

const targets = [
  ['icon-192.png', 192, 0.12],
  ['icon-512.png', 512, 0.12],
  ['icon-maskable-512.png', 512, 0.2],
];

const outDir = new URL('../public/icons/', import.meta.url);
await mkdir(outDir, { recursive: true });
for (const [name, size, padding] of targets) {
  const png = paint(size, padding);
  await writeFile(new URL(name, outDir), png);
  console.log(`icons: wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
