// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';
import type { WasteReportDto } from 'cloud-cost-application';
import type { DeadResourcesReportDto } from 'dead-resources-application';
import type { ResourceSecurityReportDto } from 'resource-security-application';
import { readTrendSnapshots, type TrendDomain, type TrendSnapshotRecord } from 'shared-trend-store';
import { formatTrendHistoryAsTable } from '../formatters/trend-history.table-formatter';
import { formatTrendHistoryAsJson } from '../formatters/trend-history.json-formatter';
import { formatHistoryComparisonAsTable } from '../formatters/history-comparison.table-formatter';
import { formatHistoryComparisonAsJson } from '../formatters/history-comparison.json-formatter';
import { generateHistoryReportHtml } from '../formatters/history-report.html-formatter';
import { compareCloudCostSnapshots, compareHygieneSnapshots, type HistoryComparison } from './history-comparison';
import { isOutputFormat } from '../output-format';
import { resolveCredentials } from './resolve-options';
import { reportCliError as fail } from './report-cli-error';

export const HISTORY_FORMATS = ['table', 'json'] as const;
const HISTORY_DOMAINS = ['cloud-cost', 'dead-resources', 'resource-security'] as const;

function isTrendDomain(value: string): value is TrendDomain {
  return (HISTORY_DOMAINS as readonly string[]).includes(value);
}

/**
 * Dispatches on `domain` with a concrete (never union'd) DTO cast in each
 * branch — `compareHygieneSnapshots`'s `older`/`newer` share one type
 * parameter, so both arguments in a single call must resolve to the exact
 * same concrete type; casting each independently to the
 * `DeadResourcesReportDto | ResourceSecurityReportDto` union here would
 * reintroduce the same inference problem that generic exists to avoid.
 */
function buildComparison(domain: TrendDomain, older: TrendSnapshotRecord, newer: TrendSnapshotRecord): HistoryComparison {
  switch (domain) {
    case 'cloud-cost':
      return compareCloudCostSnapshots(JSON.parse(older.payload) as WasteReportDto, JSON.parse(newer.payload) as WasteReportDto);
    case 'dead-resources':
      return compareHygieneSnapshots('dead-resources', JSON.parse(older.payload) as DeadResourcesReportDto, JSON.parse(newer.payload) as DeadResourcesReportDto);
    case 'resource-security':
      return compareHygieneSnapshots(
        'resource-security',
        JSON.parse(older.payload) as ResourceSecurityReportDto,
        JSON.parse(newer.payload) as ResourceSecurityReportDto,
      );
  }
}

export interface HistoryCommandOptions {
  accountId?: string;
  assumeRoleArn?: string;
  externalId?: string;
  domain?: string;
  limit?: string;
  compare?: string;
  html?: string | boolean;
  format?: string;
}

export interface HistoryDeps {
  resolveAccountId(credentials?: AwsCredentialIdentityProvider): Promise<string | undefined>;
  readSnapshots: typeof readTrendSnapshots;
  writeHtmlReport: (path: string, html: string) => Promise<void>;
}

async function writeHtmlReportToDisk(path: string, html: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html);
}

export const defaultHistoryDeps: HistoryDeps = {
  resolveAccountId: resolveAwsAccountId,
  readSnapshots: readTrendSnapshots,
  writeHtmlReport: writeHtmlReportToDisk,
};

/**
 * `history`: reads back the local trend store
 * (`~/.cloudrift/trends/<account-id>.db`) that `analyze` / `dead-resources` /
 * `resource-security` each append a full snapshot to on every run — a local
 * scan history, never uploaded anywhere (see ADR-0099). Read-only: the only
 * AWS call is the STS lookup used to resolve which account's file to open.
 *
 * `--compare <n>` switches to a two-run diff instead of the plain list:
 * the latest snapshot vs. the one `n` runs back, for one domain at a time.
 * For `cloud-cost` this includes a "presumed resolved" dollar figure — an
 * inference (findings gone between the two runs), not a confirmed saving,
 * since cloudrift never remediates anything itself (see `history-comparison.ts`).
 *
 * `--html [filename]` additionally writes a self-contained HTML report (inline
 * SVG line chart + table view, no chart-library dependency) of one domain's
 * metric over every stored run — independent of `--compare`/stdout `--format`,
 * same "additional file artifact" convention as `--pdf`/`--csv` elsewhere.
 */
export async function historyCommand(
  options: HistoryCommandOptions,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<void> {
  const format = options.format ?? 'table';
  if (!isOutputFormat(HISTORY_FORMATS, format)) {
    return fail(`--format must be one of: ${HISTORY_FORMATS.join(', ')}. Got "${options.format}".`);
  }

  if (options.domain !== undefined && !isTrendDomain(options.domain)) {
    return fail(`--domain must be one of: ${HISTORY_DOMAINS.join(', ')}. Got "${options.domain}".`);
  }

  let limit: number | undefined;
  if (options.limit !== undefined) {
    const parsed = Number(options.limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fail(`--limit must be a positive integer, got "${options.limit}".`);
    }
    limit = parsed;
  }

  let compareN: number | undefined;
  if (options.compare !== undefined) {
    if (options.domain === undefined || !isTrendDomain(options.domain)) {
      return fail('--compare requires --domain (cloud-cost, dead-resources, or resource-security) to know which report shape to compare.');
    }
    const parsed = Number(options.compare);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fail(`--compare must be a positive integer (how many runs back to compare against), got "${options.compare}".`);
    }
    compareN = parsed;
  }

  const credentialsResult = await resolveCredentials(options);
  if (!credentialsResult.ok) return fail(credentialsResult.error.message);
  const credentials = credentialsResult.value;

  const accountId = options.accountId ?? (await deps.resolveAccountId(credentials)) ?? 'unknown';
  if (accountId === 'unknown') {
    console.error(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

  if (options.html !== undefined && options.html !== false && (options.domain === undefined || !isTrendDomain(options.domain))) {
    return fail('--html requires --domain (cloud-cost, dead-resources, or resource-security) to know which metric to chart.');
  }

  if (compareN !== undefined) {
    const domain = options.domain as TrendDomain;
    const records = await deps.readSnapshots(accountId, { domain, limit: compareN + 1 });
    if (records.length < compareN + 1) {
      return fail(`Not enough history to compare ${compareN} run(s) back — only ${records.length} snapshot(s) on record for "${domain}".`);
    }
    const comparison = buildComparison(domain, records[compareN], records[0]);
    console.log(format === 'json' ? formatHistoryComparisonAsJson(comparison) : formatHistoryComparisonAsTable(comparison));
  } else {
    const records = await deps.readSnapshots(accountId, {
      domain: options.domain as TrendDomain | undefined,
      limit,
    });
    console.log(format === 'json' ? formatTrendHistoryAsJson(records) : formatTrendHistoryAsTable(records));
  }

  if (options.html !== undefined && options.html !== false) {
    const domain = options.domain as TrendDomain;
    const htmlRecords = await deps.readSnapshots(accountId, { domain, limit: limit ?? 100 });
    const html = generateHistoryReportHtml(htmlRecords, domain, accountId);
    const day = new Date().toISOString().split('T')[0].replaceAll('-', '_');
    const outputPath =
      typeof options.html === 'string' ? resolve(process.cwd(), options.html) : resolve(process.cwd(), 'reports', `cloudrift-history-${domain}-${day}.html`);
    await deps.writeHtmlReport(outputPath, html);
    console.error(chalk.green(`  HTML report saved to ${outputPath}`));
  }
}
