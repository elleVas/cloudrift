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
  writeHtmlReportArgs: Array<[string, string]>;
} {
  const calls: unknown[] = [];
  const htmlCalls: Array<[string, string]> = [];
  return {
    resolveAccountId: async () => opts.resolvedAccountId,
    readSnapshots: (async (accountId: string, options?: unknown) => {
      calls.push([accountId, options]);
      return opts.records ?? SAMPLE_RECORDS;
    }) as HistoryDeps['readSnapshots'],
    // Never touch the real filesystem in a unit test — same reasoning as
    // mocking `shared-trend-store` in the scan commands' specs.
    writeHtmlReport: async (path: string, html: string) => {
      htmlCalls.push([path, html]);
    },
    readSnapshotsArgs: calls,
    writeHtmlReportArgs: htmlCalls,
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

  function wastePayload(totalWasteMonthlyUsd: number, findingIds: string[]) {
    return JSON.stringify({
      meta: { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-07-01T00:00:00.000Z' },
      totalWasteMonthlyUsd,
      findings: findingIds.map((id) => ({ id, kind: 'ebs-volume', monthlyCostUsd: totalWasteMonthlyUsd / (findingIds.length || 1) })),
    });
  }

  const compareRecords = [
    { id: 3, domain: 'cloud-cost' as const, generatedAt: '2026-07-30T00:00:00.000Z', payload: wastePayload(10, ['vol-2']) },
    { id: 2, domain: 'cloud-cost' as const, generatedAt: '2026-07-29T00:00:00.000Z', payload: wastePayload(20, ['vol-1', 'vol-2']) },
    { id: 1, domain: 'cloud-cost' as const, generatedAt: '2026-07-28T00:00:00.000Z', payload: wastePayload(25, ['vol-1', 'vol-2', 'vol-3']) },
  ];

  describe('--compare', () => {
    it('rejects --compare without --domain', async () => {
      const deps = makeDeps();
      await historyCommand({ compare: '1' }, deps);
      expect(stderr).toContain('--compare requires --domain');
    });

    it('rejects a non-positive --compare value', async () => {
      const deps = makeDeps();
      await historyCommand({ compare: '0', domain: 'cloud-cost' }, deps);
      expect(stderr).toContain('--compare must be a positive integer');
    });

    it('fails cleanly when there is not enough history to compare that far back', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ compare: '5', domain: 'cloud-cost' }, deps);
      expect(stderr).toContain('Not enough history to compare 5 run(s) back');
    });

    it('compares the latest run against n runs back for cloud-cost', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ compare: '2', domain: 'cloud-cost' }, deps);

      expect(deps.readSnapshotsArgs).toEqual([['123456789012', { domain: 'cloud-cost', limit: 3 }]]);
      expect(stdout).toContain('$25.00 → $10.00');
      expect(stdout).toContain('Presumed resolved');
    });

    it('prints the comparison as JSON when --format json is given', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ compare: '1', domain: 'cloud-cost', format: 'json' }, deps);

      const printed = JSON.parse(stdout);
      expect(printed.domain).toBe('cloud-cost');
      expect(printed.olderTotalWasteMonthlyUsd).toBe(20);
      expect(printed.newerTotalWasteMonthlyUsd).toBe(10);
    });
  });

  describe('--html', () => {
    it('rejects --html without --domain', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012' });
      await historyCommand({ html: true }, deps);
      expect(stderr).toContain('--html requires --domain');
      expect(deps.writeHtmlReportArgs).toHaveLength(0);
    });

    it('writes an HTML report to the default path when no filename is given', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ html: true, domain: 'cloud-cost' }, deps);

      expect(deps.writeHtmlReportArgs).toHaveLength(1);
      const [path, html] = deps.writeHtmlReportArgs[0];
      expect(path).toContain('cloudrift-history-cloud-cost-');
      expect(html).toContain('<!doctype html>');
      expect(stderr).toContain('HTML report saved to');
    });

    it('writes to the explicit filename when one is given', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ html: 'my-report.html', domain: 'cloud-cost' }, deps);

      const [path] = deps.writeHtmlReportArgs[0];
      expect(path).toContain('my-report.html');
    });

    it('does not block the normal list output on stdout', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ html: true, domain: 'cloud-cost' }, deps);

      expect(stdout).toContain('cloud-cost');
      expect(deps.writeHtmlReportArgs).toHaveLength(1);
    });

    it('also works alongside --compare', async () => {
      const deps = makeDeps({ resolvedAccountId: '123456789012', records: compareRecords });
      await historyCommand({ compare: '2', domain: 'cloud-cost', html: true }, deps);

      expect(stdout).toContain('$25.00');
      expect(deps.writeHtmlReportArgs).toHaveLength(1);
    });
  });
});
