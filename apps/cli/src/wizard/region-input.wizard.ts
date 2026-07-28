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

  // Cast, not narrowed: `Option<Value>` distributes over its type parameter —
  // even here with `Value = string` (not a union of literals), TS can't
  // correlate a per-entry `.map()` result with the conditional type's
  // resolved shape (same reasoning as `scanner-selection.wizard.ts`).
  const options = AWS_REGION_CODES.map((code) => ({ value: code, label: code })) as Option<string>[];
  const selected = await autocompleteMultiselect<string>({
    // Space only toggles the focused option after an arrow key has moved the
    // cursor at least once — clack's autocomplete prompt otherwise treats a
    // bare space as a character typed into the search box (no public option
    // to change this, see @clack/core's AutocompletePrompt#isNavigating).
    // Tab always toggles regardless, so it's called out as the reliable key.
    message: 'Which AWS regions do you want to scan? (type to search, tab to toggle, enter to confirm)',
    options,
    initialValues: [],
    placeholder: 'Type to search, e.g. "eu-w"... (press an arrow key first if space doesn\'t toggle)',
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Cancelled — no scan was run.');
    return undefined;
  }

  return selected;
}
