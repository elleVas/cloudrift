// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { AwsRegion, RESOURCE_SECURITY_KINDS, DEFAULT_IGNORE_TAG } from 'resource-security-domain';
import type { ResourceSecurityKind, ResourceSecurityPolicyOptions } from 'resource-security-domain';
import { renderBrandMark } from '../brand-mark';
import { formatResourceSecurityReportAsTable } from '../formatters/resource-security-report.table-formatter';
import { formatResourceSecurityReportAsJson } from '../formatters/resource-security-report.json-formatter';
import { formatResourceSecurityReportAsCsv } from '../formatters/resource-security-report.csv-formatter';
import { generateResourceSecurityReportPdf } from '../formatters/resource-security-report.pdf-formatter';
import { startScanSpinner } from '../wizard/scan-spinner';
import { defaultResourceSecurityDeps, type ResourceSecurityDeps } from './resource-security.composition';
import { reportCliError as fail } from './report-cli-error';
import { OUTPUT_FORMATS, isOutputFormat } from '../output-format';
import { resolveCredentials } from './resolve-options';
import { persistTrendSnapshot } from 'shared-trend-store';

export type { ResourceSecurityDeps };

export interface ResourceSecurityCommandOptions {
  regions: string[];
  accountId?: string;
  assumeRoleArn?: string;
  externalId?: string;
  format?: string;
  ignoreTag?: string;
  silent?: boolean;
  pdf?: string | boolean;
  csv?: string | boolean;
  /** Raw `--scanners` CLI input, validated against `RESOURCE_SECURITY_KINDS` below. */
  scanners?: string[];
  /** Already-validated kind filter — how the wizard's multiselect passes its choice through. `--scanners` wins if both are set. */
  scannerKinds?: ResourceSecurityKind[];
}

function isResourceSecurityKind(kind: string): kind is ResourceSecurityKind {
  return (RESOURCE_SECURITY_KINDS as readonly string[]).includes(kind);
}

/** `--scanners`: Result-free validation against the known RESOURCE_SECURITY_KINDS. */
function resolveExplicitScannerKinds(scanners: string[]): ResourceSecurityKind[] | { error: string } {
  if (!scanners.every(isResourceSecurityKind)) {
    const unknown = scanners.filter((kind) => !isResourceSecurityKind(kind));
    return { error: `--scanners: unknown check(s) "${unknown.join(', ')}". Valid values: ${RESOURCE_SECURITY_KINDS.join(', ')}.` };
  }
  return scanners;
}

/**
 * `resource-security`: read-only security-posture scan (IAM/account
 * hygiene, network exposure, public storage, encryption at rest,
 * visibility/audit). Its own top-level command, not a flag on `analyze` or
 * `dead-resources` — a different domain with a different report shape
 * (risk severity, not $/month or hygiene), same pattern as ADR-0078.
 */
export async function resourceSecurityCommand(
  options: ResourceSecurityCommandOptions,
  deps: ResourceSecurityDeps = defaultResourceSecurityDeps,
): Promise<void> {
  const format = options.format ?? 'table';
  if (!isOutputFormat(OUTPUT_FORMATS, format)) {
    return fail(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Got "${options.format}".`);
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
      chalk.bold.blue(`\n  Scanning ${regions.map((r) => r.code).join(', ')} (account ${accountId}) for security-posture risks...\n`),
    );
  }

  const policyOptions: ResourceSecurityPolicyOptions = {
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
      rendered = formatResourceSecurityReportAsJson(result.value, meta);
    } else if (format === 'csv') {
      rendered = formatResourceSecurityReportAsCsv(result.value, meta);
    } else {
      rendered = formatResourceSecurityReportAsTable(result.value);
    }
    console.log(rendered);
  }

  const day = meta.generatedAt.toISOString().split('T')[0].replaceAll('-', '_');

  if (options.csv !== undefined && options.csv !== false) {
    const csvPath =
      typeof options.csv === 'string'
        ? resolve(process.cwd(), options.csv)
        : resolve(process.cwd(), 'reports', `cloudrift-resource-security-${day}.csv`);
    await mkdir(dirname(csvPath), { recursive: true });
    await writeFile(csvPath, formatResourceSecurityReportAsCsv(result.value, meta));
    info(chalk.green(`  CSV report saved to ${csvPath}`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const outputPath =
      typeof options.pdf === 'string'
        ? resolve(process.cwd(), options.pdf)
        : resolve(process.cwd(), 'reports', `cloudrift-resource-security-${day}.pdf`);
    await mkdir(dirname(outputPath), { recursive: true });
    await generateResourceSecurityReportPdf(result.value, meta, outputPath);
    info(chalk.green(`  PDF report saved to ${outputPath}`));
  }

  await persistTrendSnapshot(accountId, {
    domain: 'resource-security',
    generatedAt: meta.generatedAt.toISOString(),
    payload: formatResourceSecurityReportAsJson(result.value, meta),
  });
}
