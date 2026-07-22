// SPDX-License-Identifier: Apache-2.0

/**
 * Whether an interactive prompt should run: only in a real terminal, never
 * in CI or when stdout is piped/redirected — those must keep their default
 * (non-interactive) behavior instead of blocking on input. Shared by every
 * wizard step (scanner selection, the entry wizard's mode/region/output
 * pickers, the Cost Explorer spend confirmation) so they all agree on the
 * same definition of "interactive".
 */
export function isInteractiveTty(): boolean {
  return process.env.CI !== 'true' && process.stdout.isTTY === true;
}
