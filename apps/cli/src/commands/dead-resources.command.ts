// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { AwsRegion, DEAD_RESOURCE_KINDS, DEFAULT_IGNORE_TAG } from 'dead-resources-domain';
import type { DeadResourceKind, DeadResourcePolicyOptions } from 'dead-resources-domain';
import { renderBrandMark } from '../brand-mark';
import { formatDeadResourcesReportAsTable } from '../formatters/dead-resources-report.table-formatter';
import { formatDeadResourcesReportAsJson } from '../formatters/dead-resources-report.json-formatter';
import { formatDeadResourcesReportAsCsv } from '../formatters/dead-resources-report.csv-formatter';
import { generateDeadResourcesReportPdf } from '../formatters/dead-resources-report.pdf-formatter';
import { startScanSpinner } from '../wizard/scan-spinner';
import { defaultDeadResourcesDeps, type DeadResourcesDeps } from './dead-resources.composition';
import { reportCliError as fail } from './report-cli-error';
import { OUTPUT_FORMATS, isOutputFormat } from '../output-format';
import { resolveCredentials } from './resolve-options';
import { persistTrendSnapshot } from 'shared-trend-store';

export type { DeadResourcesDeps };

export interface DeadResourcesCommandOptions {
  regions: string[];
  accountId?: string;
  assumeRoleArn?: string;
  externalId?: string;
  format?: string;
  minAgeDays?: string;
  ignoreTag?: string;
  silent?: boolean;
  pdf?: string | boolean;
  csv?: string | boolean;
  /** Raw `--scanners` CLI input, validated against `DEAD_RESOURCE_KINDS` below. */
  scanners?: string[];
  /** Already-validated kind filter — how the wizard's multiselect passes its choice through. `--scanners` wins if both are set. */
  scannerKinds?: DeadResourceKind[];
}

function isDeadResourceKind(kind: string): kind is DeadResourceKind {
  return (DEAD_RESOURCE_KINDS as readonly string[]).includes(kind);
}

/** `--scanners`: Result-free validation against the known DEAD_RESOURCE_KINDS (mirrors `resolveExplicitScanners` for `analyze`). */
function resolveExplicitScannerKinds(scanners: string[]): DeadResourceKind[] | { error: string } {
  if (!scanners.every(isDeadResourceKind)) {
    const unknown = scanners.filter((kind) => !isDeadResourceKind(kind));
    return { error: `--scanners: unknown check(s) "${unknown.join(', ')}". Valid values: ${DEAD_RESOURCE_KINDS.join(', ')}.` };
  }
  return scanners;
}

/**
 * `dead-resources`: hygiene scan for always-$0 dead/unused AWS resources
 * (currently: unused EC2 key pairs). Deliberately its own top-level command,
 * not a flag on `analyze` — a different domain with a different report
 * shape (severity, not $/month), see ADR-0078.
 */
export async function deadResourcesCommand(
  options: DeadResourcesCommandOptions,
  deps: DeadResourcesDeps = defaultDeadResourcesDeps,
): Promise<void> {
  const format = options.format ?? 'table';
  if (!isOutputFormat(OUTPUT_FORMATS, format)) {
    return fail(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Got "${options.format}".`);
  }

  let minAgeDays: number | undefined;
  if (options.minAgeDays !== undefined) {
    const parsed = Number(options.minAgeDays);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return fail(`--min-age-days must be a non-negative integer, got "${options.minAgeDays}".`);
    }
    minAgeDays = parsed;
  }

  let scannerKinds = options.scannerKinds;
  if (options.scanners && options.scanners.length > 0) {
    const resolved = resolveExplicitScannerKinds(options.scanners);
    if ('error' in resolved) return fail(resolved.error);
    scannerKinds = resolved;
  }

  const regions: AwsRegion[] = [];
  for (const code of options.regions) {
    const parsed = AwsRegion.parse(code);
    if (!parsed.ok) return fail(parsed.error.message);
    regions.push(parsed.value);
  }

  const silent = options.silent === true;
  const quietStdout = format !== 'table' || silent;
  const info = silent ? () => undefined : quietStdout ? (msg: string) => console.error(msg) : (msg: string) => console.log(msg);

  if (!quietStdout) {
    console.log(`\n${renderBrandMark()}\n`);
  }

  const credentialsResult = await resolveCredentials(options);
  if (!credentialsResult.ok) return fail(credentialsResult.error.message);
  const credentials = credentialsResult.value;

  const accountId = options.accountId ?? (await deps.resolveAccountId(credentials)) ?? 'unknown';
  if (accountId === 'unknown') {
    info(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

  if (!quietStdout) {
    console.log(
      chalk.bold.blue(
        `\n  Scanning ${regions.map((r) => r.code).join(', ')} (account ${accountId}) for dead/unused resources...\n`,
      ),
    );
  }

  const policyOptions: DeadResourcePolicyOptions = {
    minAgeDays,
    ignoreTag: options.ignoreTag ?? DEFAULT_IGNORE_TAG,
  };

  const { useCase } = await deps.createAnalysis({ regions, accountId, credentials, policyOptions, scannerKinds });

  const spinner = quietStdout ? undefined : await startScanSpinner('  Rolling through your account...');
  const result = await useCase.execute({ regions });
  spinner?.stop(chalk.dim('  Scan complete.'));
  if (!result.ok) return fail(result.error.message);

  const meta = { accountId, regions: regions.map((r) => r.code), generatedAt: new Date() };

  if (!silent) {
    let rendered: string;
    if (format === 'json') {
      rendered = formatDeadResourcesReportAsJson(result.value, meta);
    } else if (format === 'csv') {
      rendered = formatDeadResourcesReportAsCsv(result.value, meta);
    } else {
      rendered = formatDeadResourcesReportAsTable(result.value);
    }
    console.log(rendered);
  }

  const day = meta.generatedAt.toISOString().split('T')[0].replaceAll('-', '_');

  if (options.csv !== undefined && options.csv !== false) {
    const csvPath =
      typeof options.csv === 'string'
        ? resolve(process.cwd(), options.csv)
        : resolve(process.cwd(), 'cloudrift-reports', `cloudrift-dead-resources-${day}.csv`);
    await mkdir(dirname(csvPath), { recursive: true });
    await writeFile(csvPath, formatDeadResourcesReportAsCsv(result.value, meta));
    info(chalk.green(`  CSV report saved to ${csvPath}`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const outputPath =
      typeof options.pdf === 'string'
        ? resolve(process.cwd(), options.pdf)
        : resolve(process.cwd(), 'cloudrift-reports', `cloudrift-dead-resources-${day}.pdf`);
    await mkdir(dirname(outputPath), { recursive: true });
    await generateDeadResourcesReportPdf(result.value, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }

  await persistTrendSnapshot(accountId, {
    domain: 'dead-resources',
    generatedAt: meta.generatedAt.toISOString(),
    payload: formatDeadResourcesReportAsJson(result.value, meta),
  });
}
