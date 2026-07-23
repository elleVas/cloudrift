// SPDX-License-Identifier: Apache-2.0
import type { Option } from '@clack/prompts';
import { RESOURCE_SECURITY_KINDS, RESOURCE_SECURITY_KIND_META, type ResourceSecurityKind } from 'resource-security-domain';

/**
 * Multi-select prompt for the `resource-security` wizard flow. Mirrors
 * `dead-resource-selection.wizard.ts`'s shape exactly (flat list, no forced
 * category grouping) over a different kind union.
 *
 * Returns `undefined` if the user cancels (Ctrl+C).
 */
export async function promptResourceSecuritySelection(): Promise<ResourceSecurityKind[] | undefined> {
  const { cancel, intro, isCancel, multiselect } = await import('@clack/prompts');
  intro('Select the security-posture checks to run (space to toggle, enter to confirm)');
  const options = RESOURCE_SECURITY_KINDS.map((kind) => ({
    value: kind,
    label: RESOURCE_SECURITY_KIND_META[kind].label,
  })) as Option<ResourceSecurityKind>[];
  const selected = await multiselect<ResourceSecurityKind>({
    message: 'Checks to run',
    options,
    initialValues: [...RESOURCE_SECURITY_KINDS],
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Cancelled — no scan was run.');
    return undefined;
  }

  return selected;
}
