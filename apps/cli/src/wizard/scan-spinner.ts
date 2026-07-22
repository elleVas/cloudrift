// SPDX-License-Identifier: Apache-2.0
import { isInteractiveTty } from './tty';

export interface ScanSpinner {
  stop(message?: string): void;
}

const TRACK_LENGTH = 14;
// Cycling through these as it advances along the track suggests tumbling/rotation.
const GLYPHS = ['o', 'O', '0', 'O'];

function frame(position: number): string {
  const glyph = GLYPHS[position % GLYPHS.length];
  return '.'.repeat(position) + glyph + '.'.repeat(TRACK_LENGTH - 1 - position);
}

/**
 * Rolling-tumbleweed spinner wrapped around the actual scan
 * (`useCase.execute`) — that step can take anywhere from a few seconds to
 * tens of seconds depending on regions/scanners, and previously just sat
 * silent the whole time. Deliberately scoped to only that step: the
 * pricing-fetch messages printed just before it (see `pricing.factory.ts`)
 * are plain `console.log` calls, not spinner-aware, so starting the
 * spinner any earlier would interleave with them and garble the terminal.
 *
 * Falls back to doing nothing outside a real terminal (CI/non-TTY/quiet
 * output) — spinner escape codes must never reach piped/redirected output.
 */
export async function startScanSpinner(message: string): Promise<ScanSpinner> {
  if (!isInteractiveTty()) {
    return { stop: () => undefined };
  }

  const { spinner } = await import('@clack/prompts');
  const s = spinner({
    frames: Array.from({ length: TRACK_LENGTH }, (_, i) => frame(i)),
    delay: 120,
  });
  s.start(message);
  return { stop: (finalMessage) => s.stop(finalMessage) };
}
