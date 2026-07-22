// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { BRAND_MARK_ICON } from './brand-mark-icon-data';
import type { PixelArtCell } from './pixel-art-cell';

/**
 * Small pixel-art rendition of the real cloudrift logo (cloud + wave),
 * sampled from `docs/assets/cloudrift.png` by
 * `scripts/generate-brand-mark-icon.mjs` into `brand-mark-icon-data.ts` —
 * shown beside the "cloudrift" wordmark, the one piece of chrome every
 * command shares (`analyze`'s banner and the wizard's intro both call
 * `renderBrandMark()`) instead of each having its own separate ASCII scene.
 *
 * Each terminal character packs two source pixel rows via the half-block
 * technique (foreground = top pixel, background = bottom pixel, glyph =
 * '▀'), doubling vertical resolution versus one flat-colored block per
 * cell. A thin violet-to-cyan gradient border frames the icon and the
 * title/subtitle together — tried a solid filled background behind both
 * first, but that read as a heavy flat rectangle rather than a logo,
 * especially over the rows with no text in them. An outline is much
 * lighter while still visually tying icon and text into one unit.
 *
 * Transparent cells render as a plain space (no forced background) — the
 * icon's own navy fill previously masked the terminal's real background
 * behind the circle's corners; this lets whatever the terminal theme
 * actually is show through instead.
 */
function renderCell({ top, bottom }: PixelArtCell): string {
  if (top === null && bottom === null) return ' ';
  if (top === null) return chalk.hex(bottom as string)('▄');
  if (bottom === null) return chalk.hex(top)('▀');
  return chalk.hex(top).bgHex(bottom)('▀');
}

// Pulled from the logo's own wave palette instead of an unrelated bright
// "SaaS" blue, so the title reads as part of the same object as the icon.
const TITLE_ACCENT = '#B9AEE8';
const SUBTITLE = '#8A93A6';
const DEDICATION = '#6B7280';
const BORDER_A = '#8C7AE0'; // violet
const BORDER_B = '#4FD1D9'; // cyan
const ICON_WIDTH = BRAND_MARK_ICON[0].length;
const GAP = 2;
const TEXT_WIDTH = 32;
const INNER_WIDTH = ICON_WIDTH + GAP + TEXT_WIDTH;

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

/** Pads the plain text to `TEXT_WIDTH` *before* coloring — padding an already-chalk-wrapped string pads with plain spaces after its reset code, which is fine here, but keeps every text row the same visible width for the right border to line up. */
function textCell(text: string, style: (s: string) => string): string {
  return style(text.padEnd(TEXT_WIDTH));
}

/** Inserts a thin space between characters — a small, deliberate amount of tracking that reads less like a default bold UI label next to a pixel-art icon. */
function tracked(text: string): string {
  return text.split('').join(' ');
}

export function renderBrandMark(): string {
  const gap = ' '.repeat(GAP);
  const iconRows = BRAND_MARK_ICON.map((line) => line.map(renderCell).join(''));

  const mid = Math.floor(iconRows.length / 2) - 1;
  const blankText = ' '.repeat(TEXT_WIDTH);
  const textByRow = new Array(iconRows.length).fill(blankText) as string[];
  textByRow[mid] = textCell(tracked('cloudrift'), (s) => chalk.bold.hex(TITLE_ACCENT)(s));
  textByRow[mid + 1] = textCell('─'.repeat(9), (s) => chalk.hex(TITLE_ACCENT)(s));
  textByRow[mid + 2] = textCell('AWS waste & cost intelligence', (s) => chalk.hex(SUBTITLE)(s));
  textByRow[mid + 4] = textCell('for Asia, my little one ♥', (s) => chalk.hex(DEDICATION)(s));

  const top = chalk.hex(BORDER_A)('┌') + '─'.repeat(INNER_WIDTH + 2).split('').map((c, i) => chalk.hex(lerpHex(BORDER_A, BORDER_B, i / (INNER_WIDTH + 1)))(c)).join('') + chalk.hex(BORDER_B)('┐');
  const bottom = chalk.hex(BORDER_A)('└') + '─'.repeat(INNER_WIDTH + 2).split('').map((c, i) => chalk.hex(lerpHex(BORDER_A, BORDER_B, i / (INNER_WIDTH + 1)))(c)).join('') + chalk.hex(BORDER_B)('┘');

  const middleRows = iconRows.map((iconRow, i) => {
    const t = i / (iconRows.length - 1);
    const side = chalk.hex(lerpHex(BORDER_A, BORDER_B, t))('│');
    return `${side} ${iconRow}${gap}${textByRow[i]} ${side}`;
  });

  return [top, ...middleRows, bottom].join('\n');
}
