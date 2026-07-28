// SPDX-License-Identifier: Apache-2.0
import type { OutputFormat, WasteOutputFormat } from '../output-format';

export interface WasteOutputChoice {
  format: WasteOutputFormat;
  savePdf: boolean;
  saveJson: boolean;
  saveCsv: boolean;
}

/** Output format + optional file artifacts for the waste-scan wizard flow. */
export async function promptWasteOutput(): Promise<WasteOutputChoice | undefined> {
  const { select, confirm, cancel, isCancel } = await import('@clack/prompts');

  const format = await select<WasteOutputChoice['format']>({
    message: 'How should the report be shown on screen?',
    options: [
      { value: 'table', label: 'Table (default)' },
      { value: 'json', label: 'JSON' },
      { value: 'markdown', label: 'Markdown' },
    ],
    initialValue: 'table',
  });
  if (isCancel(format)) return bail(cancel);

  const savePdf = await confirm({ message: 'Also save a PDF report to disk?', initialValue: false });
  if (isCancel(savePdf)) return bail(cancel);

  const saveJson = await confirm({ message: 'Also save a JSON report to disk?', initialValue: false });
  if (isCancel(saveJson)) return bail(cancel);

  const saveCsv = await confirm({ message: 'Also save a CSV report to disk?', initialValue: false });
  if (isCancel(saveCsv)) return bail(cancel);

  return { format, savePdf, saveJson, saveCsv };
}

export interface DeadResourcesOutputChoice {
  format: OutputFormat;
  savePdf: boolean;
  saveCsv: boolean;
}

/** Output format + optional PDF for the dead-resources wizard flow — table/json only, no markdown (see dead-resources.command.ts). */
export async function promptDeadResourcesOutput(): Promise<DeadResourcesOutputChoice | undefined> {
  const { select, confirm, cancel, isCancel } = await import('@clack/prompts');

  const format = await select<DeadResourcesOutputChoice['format']>({
    message: 'How should the report be shown on screen?',
    options: [
      { value: 'table', label: 'Table (default)' },
      { value: 'json', label: 'JSON' },
    ],
    initialValue: 'table',
  });
  if (isCancel(format)) return bail(cancel);

  const savePdf = await confirm({ message: 'Also save a PDF report to disk?', initialValue: false });
  if (isCancel(savePdf)) return bail(cancel);

  const saveCsv = await confirm({ message: 'Also save a CSV report to disk?', initialValue: false });
  if (isCancel(saveCsv)) return bail(cancel);

  return { format, savePdf, saveCsv };
}

export type ResourceSecurityOutputChoice = DeadResourcesOutputChoice;

/** Output format + optional PDF for the resource-security wizard flow — table/json only, no markdown, same shape as dead-resources. */
export async function promptResourceSecurityOutput(): Promise<ResourceSecurityOutputChoice | undefined> {
  return promptDeadResourcesOutput();
}

export interface CostTrendOutputChoice {
  format: OutputFormat;
  savePdf: boolean;
  saveCsv: boolean;
}

/** Output format + optional file artifacts for the cost/trend wizard flow. */
export async function promptCostTrendOutput(): Promise<CostTrendOutputChoice | undefined> {
  const { select, confirm, cancel, isCancel } = await import('@clack/prompts');

  const format = await select<OutputFormat>({
    message: 'How should the report be shown?',
    options: [
      { value: 'table', label: 'Table / chart (default)' },
      { value: 'json', label: 'JSON' },
    ],
    initialValue: 'table',
  });
  if (isCancel(format)) return bail(cancel);

  const savePdf = await confirm({ message: 'Also save a PDF report to disk?', initialValue: false });
  if (isCancel(savePdf)) return bail(cancel);

  const saveCsv = await confirm({ message: 'Also save a CSV report to disk?', initialValue: false });
  if (isCancel(saveCsv)) return bail(cancel);

  return { format, savePdf, saveCsv };
}

function bail(cancelFn: (message?: string) => void): undefined {
  cancelFn('Cancelled — no scan was run.');
  return undefined;
}
