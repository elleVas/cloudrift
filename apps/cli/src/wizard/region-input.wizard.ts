// SPDX-License-Identifier: Apache-2.0
import type { Option } from '@clack/prompts';
import { AWS_REGION_CODES } from 'cloud-cost-domain';

/**
 * Region picker: `autocompleteMultiselect` instead of a plain text field, so
 * a typo (e.g. "us-eas-1") narrows the live suggestion list instead of
 * failing validation after the fact and forcing the whole wizard to restart
 * — the user sees "us-east-1"/"us-east-2" as they type and just picks one.
 *
 * Returns `undefined` if the user cancels (Ctrl+C).
 */
export async function promptRegions(): Promise<string[] | undefined> {
  const { autocompleteMultiselect, cancel, isCancel } = await import('@clack/prompts');

  const options = AWS_REGION_CODES.map((code) => ({ value: code, label: code })) as Option<string>[];
  const selected = await autocompleteMultiselect<string>({
    message: 'Which AWS regions do you want to scan? (type to search, space to toggle, enter to confirm)',
    options,
    initialValues: [],
    placeholder: 'Type to search, e.g. "eu-w"...',
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Cancelled — no scan was run.');
    return undefined;
  }

  return selected;
}
