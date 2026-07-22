// SPDX-License-Identifier: Apache-2.0

export type WizardMode = 'waste' | 'cost' | 'trend';

/**
 * Top-level "what do you want to do" choice — the entry point for the
 * wizard shown when `cloudrift` is run with no subcommand. New modes (e.g. a
 * future "dead & unused resources" domain) are added here as another
 * option; explicit subcommands (`cloudrift analyze`/`cost`/`trend`, with
 * flags) are unaffected and keep working exactly as before for CI/scripts.
 *
 * Returns `undefined` if the user cancels (Ctrl+C).
 */
export async function promptMode(): Promise<WizardMode | undefined> {
  const { select, cancel, isCancel } = await import('@clack/prompts');

  const mode = await select<WizardMode>({
    message: 'What do you want to do?',
    options: [
      { value: 'waste', label: 'Find wasted resources', hint: 'free — scans your account, no AWS billing calls' },
      {
        value: 'cost',
        label: 'Compare spend vs. last month',
        hint: 'Cost Explorer — $0.01/request',
      },
      {
        value: 'trend',
        label: 'View monthly spend trend',
        hint: 'Cost Explorer — $0.01/request',
      },
    ],
  });

  if (isCancel(mode)) {
    cancel('Cancelled.');
    return undefined;
  }

  return mode;
}
