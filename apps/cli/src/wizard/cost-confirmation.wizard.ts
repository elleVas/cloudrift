// SPDX-License-Identifier: Apache-2.0
import { isInteractiveTty } from './tty';

/**
 * `cost`/`trend` are the only cloudrift commands that call a billed AWS API
 * (Cost Explorer, $0.01/request) — every other scanner uses free describe/
 * list calls. This asks for explicit confirmation before spending, unless
 * the caller already opted in (`--yes`), is scripted (CI/non-TTY, same
 * convention as the scanner-selection wizard), or asked for `--silent`
 * output (already an explicit non-interactive choice).
 *
 * Returns `true` if the call should proceed.
 */
export async function confirmCostExplorerCharge(opts: { yes: boolean; silent: boolean }): Promise<boolean> {
  if (opts.yes || opts.silent || !isInteractiveTty()) return true;

  const { confirm, cancel, isCancel } = await import('@clack/prompts');
  const proceed = await confirm({
    message: 'This calls AWS Cost Explorer, which bills $0.01 per request. Continue?',
    initialValue: true,
  });

  if (isCancel(proceed) || proceed === false) {
    cancel('Cancelled — no charge was made.');
    return false;
  }

  return true;
}
