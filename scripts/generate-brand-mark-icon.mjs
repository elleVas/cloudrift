#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// One-off/dev codegen: samples docs/assets/cloudrift.png into a small
// character grid and writes apps/cli/src/brand-mark-icon-data.ts — the real
// pixel data the CLI's brand mark renders with chalk (half-block '▀'
// technique: each terminal row packs two source pixel rows, foreground =
// top pixel, background = bottom pixel, doubling vertical resolution).
// Re-run this whenever docs/assets/cloudrift.png changes; `jimp` is a
// devDependency used only by this script, never shipped in the CLI bundle.
import { Jimp, intToRGBA } from 'jimp';
import { writePixelGridData, toHex } from './lib/write-pixel-grid.mjs';

const SOURCE = 'docs/assets/cloudrift.png';
const OUTPUT = 'apps/cli/src/brand-mark-icon-data.ts';
// Optional: also write an upscaled PNG preview of exactly what the sampled
// grid looks like (each cell = a flat-colored square, no half-block trick),
// so the fidelity of the downsample can be checked visually without a
// terminal. Pass --preview=<path> to enable.
const PREVIEW_ARG = process.argv.find((a) => a.startsWith('--preview='));
const PREVIEW_PATH = PREVIEW_ARG?.slice('--preview='.length);
const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
// 22x11 and 30x15 (the first two sizes tried) both stayed blurry — turns
// out the source PNG itself has anti-aliased/blended edges between color
// bands (verified: scanning a row for runs of identical pixel color came
// back almost entirely run-length 1, i.e. no clean native low-res pixel
// grid to recover by aligning the resize). Downsampling a blended image
// only blurs it further. `posterize` snaps every band back to a handful of
// flat, distinct colors *before* the resize, which is what actually fixed
// the legibility — algorithm/size alone (nearest-neighbor vs. bilinear,
// 22 vs. 30) made comparatively little difference in side-by-side previews.
const WIDTH = Number(arg('width', '40')); // character columns
const ROWS = Number(arg('rows', '20')); // character rows (samples ROWS*2 source pixel rows)
// Deliberately omitted unless overridden: passing an explicit `mode` (even
// 'bilinearInterpolation', jimp's own documented default) routes through a
// visibly different — and here, noisier, with stray off-palette pixels at
// color-band edges — code path than leaving `mode` unset. Verified by
// diffing both outputs side by side; not documented anywhere, just an
// empirical finding. Leave this alone unless you've confirmed a specific
// `--mode=` value looks *better*, not just different.
const MODE = arg('mode', undefined);
const POSTERIZE_LEVELS = Number(arg('posterize', '6'));
const ALPHA_THRESHOLD = 128;

const image = await Jimp.read(SOURCE);
if (POSTERIZE_LEVELS > 0) image.posterize(POSTERIZE_LEVELS);
image.resize(MODE ? { w: WIDTH, h: ROWS * 2, mode: MODE } : { w: WIDTH, h: ROWS * 2 });

await writePixelGridData({
  outputPath: OUTPUT,
  exportName: 'BRAND_MARK_ICON',
  sourceLabel: SOURCE,
  width: WIDTH,
  rows: ROWS,
  previewPath: PREVIEW_PATH,
  colorAt: (col, row) => {
    const rgba = intToRGBA(image.getPixelColor(col, row));
    return rgba.a < ALPHA_THRESHOLD ? null : toHex(rgba);
  },
});
