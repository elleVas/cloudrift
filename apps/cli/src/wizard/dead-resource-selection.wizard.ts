// SPDX-License-Identifier: Apache-2.0
import type { Option } from '@clack/prompts';
import { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META, type DeadResourceKind } from 'dead-resources-domain';

/**
 * Multi-select prompt for the `dead-resources` wizard flow. Mirrors
 * `scanner-selection.wizard.ts`'s shape exactly (flat list, no forced
 * category grouping — see ADR-0078) over a different kind union.
 *
 * Returns `undefined` if the user cancels (Ctrl+C).
 */
export async function promptDeadResourceSelection(): Promise<DeadResourceKind[] | undefined> {
  const { cancel, intro, isCancel, multiselect } = await import('@clack/prompts');
  intro('Select the dead/unused resource checks to run (space to toggle, enter to confirm)');
  const options = DEAD_RESOURCE_KINDS.map((kind) => ({
    value: kind,
    label: DEAD_RESOURCE_KIND_META[kind].label,
  })) as Option<DeadResourceKind>[];
  const selected = await multiselect<DeadResourceKind>({
    message: 'Checks to run',
    options,
    initialValues: [...DEAD_RESOURCE_KINDS],
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Cancelled — no scan was run.');
    return undefined;
  }

  return selected;
}
