// SPDX-License-Identifier: Apache-2.0
import { isInteractiveTty } from './tty';

export interface ScanSpinner {
  stop(message?: string): void;
}

const TRACK_LENGTH = 14;
// Cycling through these as it advances along the track suggests tumbling/rotation.
const GLYPHS = ['o', 'O', '0', 'O'];
// How many ticks each track position holds for — see the `delay` doc comment
// below: the tick rate itself must stay short, so this is what actually
// controls how fast the tumbleweed appears to move.
const HOLD_TICKS = 4;

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
 *
 * `delay` (ms between ticks) is also how long clack's spinner waits before
 * its *first* render — `start()` schedules the first frame via
 * `setInterval`, it never draws immediately. At 120ms, a scan that finishes
 * faster than that (e.g. dead-resources/resource-security against
 * LocalStack, or a handful of resources over a fast connection) never draws
 * a single frame: `stop()` fires first and the whole spinner — including
 * `message` — never appears on screen, only the final "done" line does.
 *
 * So `delay` has to stay short (30ms) to guarantee a fast scan still shows
 * *something*. But clack redraws on every tick, so a short delay alone also
 * makes the tumbleweed race along the track — each track position is
 * repeated `HOLD_TICKS` times below to slow the apparent motion back down
 * (4 * 30ms = 120ms per position, the pace the original single-tick 120ms
 * delay had) without touching the 30ms first-render guarantee.
 */
export async function startScanSpinner(message: string): Promise<ScanSpinner> {
  if (!isInteractiveTty()) {
    return { stop: () => undefined };
  }

  const { spinner } = await import('@clack/prompts');
  const frames = Array.from({ length: TRACK_LENGTH * HOLD_TICKS }, (_, i) => frame(Math.floor(i / HOLD_TICKS)));
  const s = spinner({ frames, delay: 30 });
  s.start(message);
  return { stop: (finalMessage) => s.stop(finalMessage) };
}
