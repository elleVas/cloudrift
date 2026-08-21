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
import { generateHistoryReportHtml, generateCombinedHistoryReportHtml } from '../formatters/history-report.html-formatter';
import { compareCloudCostSnapshots, compareHygieneSnapshots, type HistoryComparison } from './history-comparison';
import { isOutputFormat } from '../output-format';
import { isOneOf } from '../type-guards';
import { resolveCredentials } from './resolve-options';
import { reportCliError as fail } from './report-cli-error';
import { hasRegressed, type NotificationSummary } from 'shared-notifications';
import { dispatchNotifications, type NotifyFlags } from './notifications';

export const HISTORY_FORMATS = ['table', 'json'] as const;
const HISTORY_DOMAINS = ['cloud-cost', 'dead-resources', 'resource-security'] as const;

function isTrendDomain(value: string): value is TrendDomain {
  return isOneOf(HISTORY_DOMAINS, value);
}

type ParsedOption = { ok: true; value: number | undefined } | { ok: false; message: string };

/** Flattened out of `historyCommand` — a nested `if` per option adds more to cognitive complexity than a sibling early-return per option. */
function parseLimitOption(options: HistoryCommandOptions): ParsedOption {
  if (options.limit === undefined) return { ok: true, value: undefined };
  const parsed = Number(options.limit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, message: `--limit must be a positive integer, got "${options.limit}".` };
  }
  return { ok: true, value: parsed };
}

/** See `parseLimitOption` — same flattening reason. */
function parseCompareOption(options: HistoryCommandOptions): ParsedOption {
  if (options.compare === undefined) {
    if (options.notifySlack || options.notifyWebhook || options.notifyEmail || options.notifyGithubComment) {
      return { ok: false, message: '--notify-slack/--notify-webhook/--notify-email/--notify-github-comment require --compare (they notify on a regression, which only a comparison can detect).' };
    }
    return { ok: true, value: undefined };
  }
  if (options.domain === undefined || !isTrendDomain(options.domain)) {
    return { ok: false, message: '--compare requires --domain (cloud-cost, dead-resources, or resource-security) to know which report shape to compare.' };
  }
  const parsed = Number(options.compare);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, message: `--compare must be a positive integer (how many runs back to compare against), got "${options.compare}".` };
  }
  return { ok: true, value: parsed };
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

/**
 * `undefined` when the comparison shows no regression — a still-present
 * critical finding that hasn't gotten any worse isn't worth paging anyone
 * every scheduled run, only an actual change for the worse is (see
 * `hasRegressed`'s doc comment).
 */
function buildRegressionNotification(comparison: HistoryComparison, accountId: string): NotificationSummary | undefined {
  if (comparison.domain === 'cloud-cost') {
    if (!hasRegressed({ newFindingsCount: comparison.newFindings.length, deltaUsd: comparison.deltaUsd })) return undefined;
    return {
      title: `cloudrift history — spend increased by $${comparison.deltaUsd.toFixed(2)}/mo (account ${accountId})`,
      domain: 'history',
      accountId,
      generatedAt: new Date(comparison.newerGeneratedAt),
      lines: comparison.newFindings.map((f) => `new: ${f.kind} ($${f.monthlyCostUsd.toFixed(2)}/mo)`),
    };
  }

  if (!hasRegressed({ newFindingsCount: comparison.newFindings.length })) return undefined;
  return {
    title: `cloudrift history (${comparison.domain}) — ${comparison.newFindings.length} new finding(s) since last run (account ${accountId})`,
    domain: 'history',
    accountId,
    generatedAt: new Date(comparison.newerGeneratedAt),
    lines: comparison.newFindings.map((f) => `new: ${f.kind} (${f.severity})`),
  };
}

export interface HistoryCommandOptions extends NotifyFlags {
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
 * Split out of `historyCommand` to keep that function's cognitive complexity
 * down — this owns the single-domain-vs-combined branch and the resulting
 * default filename, `historyCommand` just decides whether to call it.
 */
async function writeHistoryHtmlReport(
  htmlOption: string | boolean,
  domainOption: string | undefined,
  accountId: string,
  limit: number | undefined,
  deps: HistoryDeps,
): Promise<void> {
  const day = new Date().toISOString().split('T')[0].replaceAll('-', '_');
  let html: string;
  let defaultFilename: string;

  if (domainOption !== undefined) {
    const domain = domainOption as TrendDomain;
    const records = await deps.readSnapshots(accountId, { domain, limit: limit ?? 100 });
    html = generateHistoryReportHtml(records, domain, accountId);
    defaultFilename = `cloudrift-history-${domain}-${day}.html`;
  } else {
    const recordsByDomain = Object.fromEntries(
      await Promise.all(HISTORY_DOMAINS.map(async (domain) => [domain, await deps.readSnapshots(accountId, { domain, limit: limit ?? 100 })] as const)),
    ) as Record<TrendDomain, TrendSnapshotRecord[]>;
    html = generateCombinedHistoryReportHtml(recordsByDomain, accountId);
    defaultFilename = `cloudrift-history-${day}.html`;
  }

  const outputPath = typeof htmlOption === 'string' ? resolve(process.cwd(), htmlOption) : resolve(process.cwd(), 'cloudrift-reports', defaultFilename);
  await deps.writeHtmlReport(outputPath, html);
  console.error(chalk.green(`  HTML report saved to ${outputPath}`));
}

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
 * SVG line chart + table view, no chart-library dependency) over every stored
 * run — independent of `--compare`/stdout `--format`, same "additional file
 * artifact" convention as `--pdf`/`--csv` elsewhere. With `--domain`, charts
 * just that one metric; without it, stacks all three tracked domains as
 * separate cards on one page (see `generateCombinedHistoryReportHtml`).
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

  const limitResult = parseLimitOption(options);
  if (!limitResult.ok) return fail(limitResult.message);
  const limit = limitResult.value;

  const compareResult = parseCompareOption(options);
  if (!compareResult.ok) return fail(compareResult.message);
  const compareN = compareResult.value;

  const credentialsResult = await resolveCredentials(options);
  if (!credentialsResult.ok) return fail(credentialsResult.error.message);
  const credentials = credentialsResult.value;

  const accountId = options.accountId ?? (await deps.resolveAccountId(credentials)) ?? 'unknown';
  if (accountId === 'unknown') {
    console.error(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

  if (compareN !== undefined) {
    const domain = options.domain as TrendDomain;
    const records = await deps.readSnapshots(accountId, { domain, limit: compareN + 1 });
    if (records.length < compareN + 1) {
      return fail(`Not enough history to compare ${compareN} run(s) back — only ${records.length} snapshot(s) on record for "${domain}".`);
    }
    const comparison = buildComparison(domain, records[compareN], records[0]);
    console.log(format === 'json' ? formatHistoryComparisonAsJson(comparison) : formatHistoryComparisonAsTable(comparison));

    const notification = buildRegressionNotification(comparison, accountId);
    if (notification) {
      await dispatchNotifications(options, notification, (msg) => console.error(msg));
    }
  } else {
    const records = await deps.readSnapshots(accountId, {
      domain: options.domain as TrendDomain | undefined,
      limit,
    });
    console.log(format === 'json' ? formatTrendHistoryAsJson(records) : formatTrendHistoryAsTable(records));
  }

  if (options.html !== undefined && options.html !== false) {
    await writeHistoryHtmlReport(options.html, options.domain, accountId, limit, deps);
  }
}
