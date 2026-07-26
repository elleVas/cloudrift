// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';

/**
 * Standard "recoverable" CLI error: print to stderr and set `process.exitCode`
 * (never call `process.exit()` here) so pending stdout/stderr writes flush and
 * any in-flight async work finishes before the process exits naturally.
 * `process.exit()` is reserved for `main.ts`'s top-level catch, where an error
 * escaped every command's own Result-based handling and continuing is unsafe.
 */
export function reportCliError(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}
