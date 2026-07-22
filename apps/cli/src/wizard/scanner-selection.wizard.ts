// SPDX-License-Identifier: Apache-2.0
import type { Option } from '@clack/prompts';
import { RESOURCE_KINDS, RESOURCE_KIND_META, type ResourceKind } from 'cloud-cost-domain';
import { isInteractiveTty } from './tty';

/**
 * Whether the interactive scanner picker should run: only in a real terminal,
 * never in CI or when stdout is piped/redirected — those must keep scanning
 * everything without blocking on input.
 */
export function shouldPromptScannerSelection(): boolean {
  return isInteractiveTty();
}

/**
 * Multi-select prompt letting the user pick which services to scan instead of
 * always running all of them. Every service starts checked, so pressing Enter
 * immediately reproduces the previous (scan-everything) behaviour.
 *
 * Returns `undefined` if the user cancels (Ctrl+C) — the caller should abort
 * without running any scan.
 */
export async function promptScannerSelection(): Promise<ResourceKind[] | undefined> {
  const { cancel, intro, isCancel, multiselect } = await import('@clack/prompts');
  intro('Select the AWS services to scan (space to toggle, enter to confirm)');
  // Cast: RESOURCE_KINDS.map produces a `value: ResourceKind` per entry, but
  // Option<Value> distributes over the ResourceKind union into one variant per
  // literal — TS can't see that a per-entry literal always matches its variant.
  const options = RESOURCE_KINDS.map((kind) => ({
    value: kind,
    label: RESOURCE_KIND_META[kind].label,
  })) as Option<ResourceKind>[];
  const selected = await multiselect<ResourceKind>({
    message: 'Services to scan',
    options,
    initialValues: [...RESOURCE_KINDS],
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Cancelled — no scan was run.');
    return undefined;
  }

  return selected;
}
