// SPDX-License-Identifier: Apache-2.0
import { analyzeWasteCommand } from '../commands/analyze-waste.command';
import { costCommand } from '../commands/cost.command';
import { trendCommand } from '../commands/trend.command';
import { renderBrandMark } from '../brand-mark';
import { promptMode } from './mode-picker.wizard';
import { promptRegions } from './region-input.wizard';
import { promptScannerSelection } from './scanner-selection.wizard';
import { promptWasteOutput, promptSimpleOutput } from './output-format.wizard';

/**
 * The interactive entry point: shown when `cloudrift` is run with no
 * subcommand in a real terminal (see `main.ts`). Gathers the same options an
 * equivalent `analyze`/`cost`/`trend` invocation would take as flags, then
 * calls that command's own function directly — no duplicated business
 * logic, this is purely an input-gathering layer. Explicit subcommands with
 * flags (CI/scripts) never go through here.
 */
export async function runEntryWizard(): Promise<void> {
  const { intro, outro } = await import('@clack/prompts');

  console.log(`\n${renderBrandMark()}\n`);
  intro('cloudrift wizard');

  const mode = await promptMode();
  if (mode === undefined) return;

  if (mode === 'waste') {
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
    });
    return;
  }

  const format = await promptSimpleOutput();
  if (format === undefined) return;

  outro('Fetching from AWS Cost Explorer...');
  if (mode === 'cost') {
    await costCommand({ format });
  } else {
    await trendCommand({ format });
  }
}
