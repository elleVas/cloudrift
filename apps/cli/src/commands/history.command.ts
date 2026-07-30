// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';
import { readTrendSnapshots, type TrendDomain } from 'shared-trend-store';
import { formatTrendHistoryAsTable } from '../formatters/trend-history.table-formatter';
import { formatTrendHistoryAsJson } from '../formatters/trend-history.json-formatter';
import { isOutputFormat } from '../output-format';
import { resolveCredentials } from './resolve-options';
import { reportCliError as fail } from './report-cli-error';

export const HISTORY_FORMATS = ['table', 'json'] as const;
const HISTORY_DOMAINS = ['cloud-cost', 'dead-resources', 'resource-security'] as const;

function isTrendDomain(value: string): value is TrendDomain {
  return (HISTORY_DOMAINS as readonly string[]).includes(value);
}

export interface HistoryCommandOptions {
  accountId?: string;
  assumeRoleArn?: string;
  externalId?: string;
  domain?: string;
  limit?: string;
  format?: string;
}

export interface HistoryDeps {
  resolveAccountId(credentials?: AwsCredentialIdentityProvider): Promise<string | undefined>;
  readSnapshots: typeof readTrendSnapshots;
}

export const defaultHistoryDeps: HistoryDeps = {
  resolveAccountId: resolveAwsAccountId,
  readSnapshots: readTrendSnapshots,
};

/**
 * `history`: reads back the local trend store
 * (`~/.cloudrift/trends/<account-id>.db`) that `analyze` / `dead-resources` /
 * `resource-security` each append a full snapshot to on every run — a local
 * scan history, never uploaded anywhere (see ADR-0099). Read-only: the only
 * AWS call is the STS lookup used to resolve which account's file to open.
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

  const credentialsResult = await resolveCredentials(options);
  if (!credentialsResult.ok) return fail(credentialsResult.error.message);
  const credentials = credentialsResult.value;

  const accountId = options.accountId ?? (await deps.resolveAccountId(credentials)) ?? 'unknown';
  if (accountId === 'unknown') {
    console.error(chalk.dim('  Could not resolve the AWS account ID via STS — pass --account-id to set it explicitly.'));
  }

  const records = await deps.readSnapshots(accountId, {
    domain: options.domain as TrendDomain | undefined,
    limit,
  });

  console.log(format === 'json' ? formatTrendHistoryAsJson(records) : formatTrendHistoryAsTable(records));
}
