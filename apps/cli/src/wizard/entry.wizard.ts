// SPDX-License-Identifier: Apache-2.0
import { analyzeWasteCommand } from '../commands/analyze-waste.command';
import { costCommand } from '../commands/cost.command';
import { trendCommand } from '../commands/trend.command';
import { deadResourcesCommand } from '../commands/dead-resources.command';
import { resourceSecurityCommand } from '../commands/resource-security.command';
import { renderBrandMark } from '../brand-mark';
import { promptMode } from './mode-picker.wizard';
import { promptRegions } from './region-input.wizard';
import { promptScannerSelection } from './scanner-selection.wizard';
import { promptDeadResourceSelection } from './dead-resource-selection.wizard';
import { promptResourceSecuritySelection } from './resource-security-selection.wizard';
import { promptWasteOutput, promptDeadResourcesOutput, promptResourceSecurityOutput, promptCostTrendOutput } from './output-format.wizard';
import {
  resolveCloudriftIacDetectorBinary,
  playHandoffTransition,
  delegateToCloudriftIacDetector,
} from './terraform-handoff.wizard';

type Outro = (message?: string) => void;

/**
 * The interactive entry point: shown when `cloudrift` is run with no
 * subcommand in a real terminal (see `main.ts`). Gathers the same options an
 * equivalent `analyze`/`cost`/`trend` invocation would take as flags, then
 * calls that command's own function directly — no duplicated business
 * logic, this is purely an input-gathering layer. Explicit subcommands with
 * flags (CI/scripts) never go through here.
 *
 * A thin dispatcher: each mode's own input-gathering + command call lives in
 * its own `run*Mode()` function below, so this function stays a flat
 * mode → handler mapping instead of one long if-chain growing a branch per
 * mode (six now, more later) — kept it that way once six modes made the
 * single function noticeably harder to scan in one pass.
 */
export async function runEntryWizard(): Promise<void> {
  const { intro, outro } = await import('@clack/prompts');

  console.log(`\n${renderBrandMark()}\n`);
  intro('cloudrift wizard');

  const mode = await promptMode();
  if (mode === undefined) return;

  switch (mode) {
    case 'waste':
      return runWasteMode(outro);
    case 'dead-resources':
      return runDeadResourcesMode(outro);
    case 'resource-security':
      return runResourceSecurityMode(outro);
    case 'terraform':
      return runTerraformMode(outro);
    case 'cost':
    case 'trend':
      return runCostTrendMode(mode, outro);
  }
}

async function runWasteMode(outro: Outro): Promise<void> {
  const regions = await promptRegions();
  if (regions === undefined) return;

  const scanners = await promptScannerSelection();
  if (scanners === undefined) return;

  const output = await promptWasteOutput();
  if (output === undefined) return;

  outro('Starting scan...');
  await analyzeWasteCommand({
    regions,
    scanners,
    format: output.format,
    pdf: output.savePdf ? true : undefined,
    json: output.saveJson ? true : undefined,
    csv: output.saveCsv ? true : undefined,
  });
}

async function runDeadResourcesMode(outro: Outro): Promise<void> {
  const regions = await promptRegions();
  if (regions === undefined) return;

  const scannerKinds = await promptDeadResourceSelection();
  if (scannerKinds === undefined) return;

  const output = await promptDeadResourcesOutput();
  if (output === undefined) return;

  outro('Starting scan...');
  await deadResourcesCommand({
    regions,
    scannerKinds,
    format: output.format,
    pdf: output.savePdf ? true : undefined,
    csv: output.saveCsv ? true : undefined,
  });
}

async function runResourceSecurityMode(outro: Outro): Promise<void> {
  const regions = await promptRegions();
  if (regions === undefined) return;

  const scannerKinds = await promptResourceSecuritySelection();
  if (scannerKinds === undefined) return;

  const output = await promptResourceSecurityOutput();
  if (output === undefined) return;

  outro('Starting scan...');
  await resourceSecurityCommand({
    regions,
    scannerKinds,
    format: output.format,
    pdf: output.savePdf ? true : undefined,
    csv: output.saveCsv ? true : undefined,
  });
}

async function runTerraformMode(outro: Outro): Promise<void> {
  const binaryPath = resolveCloudriftIacDetectorBinary();
  if (binaryPath === undefined) {
    outro(
      "cloudrift-iac-detector wasn't found on your PATH. It's a separate Pro package — check your cloudrift Pro license for installation instructions, then run `cloudrift` again.",
    );
    return;
  }

  await playHandoffTransition();
  const exitCode = await delegateToCloudriftIacDetector(binaryPath);
  process.exitCode = exitCode;
}

async function runCostTrendMode(mode: 'cost' | 'trend', outro: Outro): Promise<void> {
  const output = await promptCostTrendOutput();
  if (output === undefined) return;

  outro('Fetching from AWS Cost Explorer...');
  const options = {
    format: output.format,
    pdf: output.savePdf ? true : undefined,
    csv: output.saveCsv ? true : undefined,
  };

  if (mode === 'cost') {
    await costCommand(options);
  } else {
    await trendCommand(options);
  }
}
