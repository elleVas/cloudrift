// SPDX-License-Identifier: Apache-2.0
import type { TrendSnapshotRecord } from 'shared-trend-store';
import { historyCommand, type HistoryCommandOptions, type HistoryDeps } from './history.command';

const SAMPLE_RECORDS: TrendSnapshotRecord[] = [
  {
    id: 2,
    domain: 'cloud-cost',
    generatedAt: '2026-07-30T00:00:00.000Z',
    payload: JSON.stringify({ wasteCount: 3, optimizationCount: 1, totalWasteMonthlyUsd: 42.5 }),
  },
  {
    id: 1,
    domain: 'dead-resources',
    generatedAt: '2026-07-29T00:00:00.000Z',
    payload: JSON.stringify({ findings: [{ id: 'a' }, { id: 'b' }] }),
  },
];

function makeDeps(opts: { resolvedAccountId?: string; records?: TrendSnapshotRecord[] } = {}): HistoryDeps & {
  readSnapshotsArgs: unknown[];
} {
  const calls: unknown[] = [];
  return {
    resolveAccountId: async () => opts.resolvedAccountId,
    readSnapshots: (async (accountId: string, options?: unknown) => {
      calls.push([accountId, options]);
      return opts.records ?? SAMPLE_RECORDS;
    }) as HistoryDeps['readSnapshots'],
    readSnapshotsArgs: calls,
  };
}

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  jest.spyOn(console, 'log').mockImplementation((...args) => {
    stdout += args.join(' ') + '\n';
  });
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    stderr += args.join(' ') + '\n';
  });
  process.exitCode = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('historyCommand', () => {
  it('rejects an unknown --format', async () => {
    const deps = makeDeps();
    await historyCommand({ format: 'markdown' } as HistoryCommandOptions, deps);
    expect(stderr).toContain('--format must be one of: table, json');
    expect(process.exitCode).toBe(1);
  });

  it('rejects an unknown --domain', async () => {
    const deps = makeDeps();
    await historyCommand({ domain: 'not-a-domain' }, deps);
    expect(stderr).toContain('--domain must be one of:');
    expect(process.exitCode).toBe(1);
  });

  it('rejects a non-positive --limit', async () => {
    const deps = makeDeps();
    await historyCommand({ limit: '0' }, deps);
    expect(stderr).toContain('--limit must be a positive integer');
    expect(process.exitCode).toBe(1);
  });

  it('resolves the account via STS when --account-id is omitted and forwards domain/limit filters', async () => {
    const deps = makeDeps({ resolvedAccountId: '123456789012' });
    await historyCommand({ domain: 'cloud-cost', limit: '5' }, deps);

    expect(deps.readSnapshotsArgs).toEqual([['123456789012', { domain: 'cloud-cost', limit: 5 }]]);
    expect(stdout).toContain('cloud-cost');
  });

  it('warns and falls back to "unknown" when the account cannot be resolved', async () => {
    const deps = makeDeps({ resolvedAccountId: undefined });
    await historyCommand({}, deps);

    expect(stderr).toContain('Could not resolve the AWS account ID via STS');
    expect(deps.readSnapshotsArgs).toEqual([['unknown', { domain: undefined, limit: undefined }]]);
  });

  it('prints JSON when --format json is given', async () => {
    const deps = makeDeps({ resolvedAccountId: '123456789012' });
    await historyCommand({ format: 'json' }, deps);

    const printed = JSON.parse(stdout);
    expect(printed).toHaveLength(2);
    expect(printed[0].payload).toEqual({ wasteCount: 3, optimizationCount: 1, totalWasteMonthlyUsd: 42.5 });
  });

  it('prints a friendly message when there is no history yet', async () => {
    const deps = makeDeps({ resolvedAccountId: '123456789012', records: [] });
    await historyCommand({}, deps);

    expect(stdout).toContain('No trend history yet');
  });
});
