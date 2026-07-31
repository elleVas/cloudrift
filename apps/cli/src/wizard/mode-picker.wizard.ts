// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { resolveCloudriftIacDetectorBinary } from './terraform-handoff.wizard';

export type WizardMode = 'waste' | 'cost' | 'trend' | 'dead-resources' | 'resource-security' | 'history' | 'terraform';

/**
 * Top-level "what do you want to do" choice — the entry point for the
 * wizard shown when `cloudrift` is run with no subcommand. Explicit
 * subcommands (`cloudrift analyze`/`cost`/`trend`/`dead-resources`/
 * `resource-security`/`history`, with flags) are unaffected and keep working
 * exactly as before for CI/scripts.
 *
 * `terraform` is the odd one out: it doesn't call a command function in
 * this package at all, it hands off to the separate, proprietary
 * `cloudrift-iac-detector` binary (see ADR-0097 and
 * `terraform-handoff.wizard.ts`) — the only mode here that can be missing
 * from the user's machine entirely.
 *
 * Returns `undefined` if the user cancels (Ctrl+C).
 */
export async function promptMode(): Promise<WizardMode | undefined> {
  const { select, cancel, isCancel } = await import('@clack/prompts');

  const terraformUnlocked = resolveCloudriftIacDetectorBinary() !== undefined;

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
      {
        value: 'dead-resources',
        label: 'Find dead/unused resources',
        hint: 'free — hygiene, no $/month (e.g. unused key pairs)',
      },
      {
        value: 'resource-security',
        label: 'Scan for security-posture risks',
        hint: 'free — IAM/MFA, open ingress, public storage, encryption, audit',
      },
      {
        value: 'history',
        label: 'View local scan history',
        hint: 'free — reads ~/.cloudrift/trends, no AWS calls except account ID resolution',
      },
      {
        value: 'terraform',
        label: terraformUnlocked ? 'Terraform source analysis (PRO)' : chalk.yellow('🔒 Terraform source analysis (PRO)'),
        hint: terraformUnlocked
          ? 'orphans, duplicates, dead code, auto-fix'
          : 'locked — separate cloudrift-iac-detector Pro package required, not found on PATH',
      },
    ],
  });

  if (isCancel(mode)) {
    cancel('Cancelled.');
    return undefined;
  }

  return mode;
}
