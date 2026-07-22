#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// One-off/dev codegen: samples docs/assets/title-cloudrift.png (a black
// background with a thin light outline spelling "CLOUDRIFT") into a small
// character grid and writes apps/cli/src/brand-mark-title-data.ts, in the
// same PixelArtCell shape and half-block rendering as the icon.
//
// The source is a hairline outline, not filled letterforms: a 1-2px stroke
// in a 645px-wide image gets averaged away to near-invisible gray the
// moment it's downsampled 15-20x, no matter how much contrast/threshold is
// applied *after* the resize (verified — tried both, letters stayed
// unreadable). The fix has to happen *before* the resize: `dilate` grows
// the bright stroke pixels into their neighborhood (a max filter) so each
// stroke is thick enough to still cover a meaningful fraction of the pixels
// being averaged into each output cell.
import { Jimp, intToRGBA, rgbaToInt } from 'jimp';
import { writePixelGridData, lerpHex } from './lib/write-pixel-grid.mjs';

const SOURCE = 'docs/assets/title-cloudrift.png';
const OUTPUT = 'apps/cli/src/brand-mark-title-data.ts';
const PREVIEW_ARG = process.argv.find((a) => a.startsWith('--preview='));
const PREVIEW_PATH = PREVIEW_ARG?.slice('--preview='.length);
const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const WIDTH = Number(arg('width', '44')); // character columns — 32 and below blurred past legibility in testing
const DILATE_RADIUS = Number(arg('dilate', '2'));
const BRIGHTNESS_THRESHOLD = Number(arg('threshold', '40'));
// Same violet-to-cyan gradient as the border in brand-mark.ts, so the title
// reads as part of the same frame instead of a third, unrelated color.
const GRADIENT_A = arg('gradientA', '#8C7AE0');
const GRADIENT_B = arg('gradientB', '#4FD1D9');

function dilate(image, radius) {
  const w = image.width;
  const h = image.height;
  const src = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { r, g, b } = intToRGBA(image.getPixelColor(x, y));
      src[y * w + x] = Math.max(r, g, b);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          m = Math.max(m, src[yy * w + xx]);
        }
      }
      image.setPixelColor(rgbaToInt(m, m, m, 255), x, y);
    }
  }
}

const image = await Jimp.read(SOURCE);
const targetH = Math.round((WIDTH / image.width) * image.height);
const rows = Math.round(targetH / 2);
dilate(image, DILATE_RADIUS);
image.resize({ w: WIDTH, h: rows * 2 });

await writePixelGridData({
  outputPath: OUTPUT,
  exportName: 'BRAND_MARK_TITLE',
  sourceLabel: SOURCE,
  width: WIDTH,
  rows,
  previewPath: PREVIEW_PATH,
  colorAt: (col, row) => {
    const { r, g, b } = intToRGBA(image.getPixelColor(col, row));
    const brightness = Math.max(r, g, b);
    if (brightness < BRIGHTNESS_THRESHOLD) return null;
    return lerpHex(GRADIENT_A, GRADIENT_B, col / (WIDTH - 1));
  },
});
