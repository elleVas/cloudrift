// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

const BINARY_NAME = 'cloudrift-iac-detector';
// Windows resolves a bare PATH entry against these extensions, in order
// (PATHEXT), before falling back to an extension-less match; POSIX only
// ever needs the bare name.
const WINDOWS_EXTENSIONS = ['.cmd', '.exe', '.bat'];

/**
 * Resolves the separate, proprietary `cloudrift-iac-detector` package's
 * binary on `PATH`, the same way a shell would — no package-manager or
 * registry lookup, since cloudrift core (public, OSS) can never depend on
 * or embed that package (see ADR-00XX: it's a paid Pro add-on, a completely
 * separate repo/product; see ADR-0097). Presence-on-PATH is the only signal available:
 * if the user installed it, this finds it; if not, there's nothing else to
 * check.
 *
 * Returns the absolute path to the binary, or `undefined` if not found.
 */
export function resolveCloudriftIacDetectorBinary(): string | undefined {
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0);
  const candidateNames = process.platform === 'win32' ? WINDOWS_EXTENSIONS.map((ext) => BINARY_NAME + ext) : [BINARY_NAME];

  for (const dir of pathDirs) {
    for (const name of candidateNames) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

const FRAME_MS = 90;
const BAR_WIDTH = 24;
// One "pixel" per frame — the bar fills left to right, 8-bit-loading-screen
// style, using block characters instead of a smooth spinner.
const FILLED = '█';
const EMPTY = '░';
const PALETTE = [chalk.magenta, chalk.cyan, chalk.yellow, chalk.green] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Short retro-styled loading-bar transition shown between picking
 * "Terraform source analysis (Pro)" and handing control over to the
 * separate `cloudrift-iac-detector` process. Purely cosmetic — its only
 * job is to make an otherwise-instant process handoff feel like an
 * intentional transition between two products, not a stall. Renders with
 * `\r` in-place redraws (classic terminal progress-bar technique), so it
 * leaves a single settled line behind rather than a scroll of frames.
 */
export async function playHandoffTransition(): Promise<void> {
  for (let filled = 0; filled <= BAR_WIDTH; filled++) {
    const color = PALETTE[filled % PALETTE.length];
    const bar = color(FILLED.repeat(filled)) + chalk.dim(EMPTY.repeat(BAR_WIDTH - filled));
    process.stdout.write(`\r  ${chalk.bold('cloudrift')} ${chalk.dim('→')} ${chalk.bold('cloudrift-iac-detector')}  [${bar}]`);
    await sleep(FRAME_MS);
  }
  process.stdout.write(`\n\n  ${chalk.green('▸')} Handing off to the Terraform Pro engine...\n\n`);
}

/**
 * Spawns the resolved `cloudrift-iac-detector` binary with inherited stdio,
 * so its own wizard (or whatever it prints) takes over the terminal exactly
 * as if the user had run it directly. Resolves with its exit code once the
 * child process closes — the caller propagates that as its own
 * `process.exitCode`, so a failure inside the Pro CLI is visible the same
 * way any other command failure here would be.
 */
export function delegateToCloudriftIacDetector(binaryPath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, [], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
  });
}
