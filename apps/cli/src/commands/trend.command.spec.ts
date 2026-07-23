// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { CostExplorerPort, CostPeriodBucket } from 'cost-analytics-domain';
import type { CloudriftConfig } from '../config/cloudrift.config';
import { trendCommand, type TrendCommandOptions } from './trend.command';
import type { CostAnalyticsDeps } from './cost-analytics.composition';

const SAMPLE_MONTHS: CostPeriodBucket[] = [
  { start: '2026-06-01', end: '2026-07-01', totalUsd: 100, byService: [{ service: 'EC2', amountUsd: 100 }], final: true },
  { start: '2026-07-01', end: '2026-07-16', totalUsd: 50, byService: [{ service: 'EC2', amountUsd: 50 }], final: false },
];

function makeDeps(opts: { config?: CloudriftConfig; buckets?: CostPeriodBucket[] } = {}): CostAnalyticsDeps {
  const port: CostExplorerPort = {
    getCostAndUsage: async () => Result.ok(opts.buckets ?? SAMPLE_MONTHS),
  };
  return {
    loadConfig: async () => Result.ok(opts.config ?? {}),
    resolveAccountId: async () => undefined,
    createCostExplorer: () => port,
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
  process.exitCode = undefined;
});

function run(options: Partial<TrendCommandOptions>, deps: CostAnalyticsDeps): Promise<void> {
  return trendCommand({ ...options }, deps);
}

describe('trendCommand (CLI end-to-end)', () => {
  it('rejects an invalid --format before doing any work (exit 1)', async () => {
    await run({ format: 'xml' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--format must be one of');
  });

  it('rejects an out-of-range --months', async () => {
    await run({ months: '0' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--months must be an integer between 1 and');
  });

  it('rejects a non-numeric --months', async () => {
    await run({ months: 'six' }, makeDeps());
    expect(process.exitCode).toBe(1);
  });

  it('table format: renders an ANSI bar chart to stdout', async () => {
    await run({ format: 'table' }, makeDeps());
    expect(stdout).toContain('Monthly spend trend');
    expect(stdout).toContain('2026-06');
    expect(stdout).toContain('2026-07');
  });

  it('json format: stdout is pure parseable JSON with both months', async () => {
    await run({ format: 'json' }, makeDeps());
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.months).toHaveLength(2);
    expect(parsed.months[1].final).toBe(false);
  });

  it('passes an unresolved shorthand through unchanged as a literal Cost Explorer name', async () => {
    await run({ format: 'json', services: ['Amazon Custom Service'] }, makeDeps());
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.filteredServices).toEqual(['Amazon Custom Service']);
  });

  it('a known shorthand resolves to the documented Cost Explorer service name', async () => {
    await run({ format: 'json', services: ['ec2'] }, makeDeps());
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.filteredServices).toEqual(['Amazon Elastic Compute Cloud - Compute']);
  });

  it('--silent suppresses stdout entirely', async () => {
    await run({ format: 'table', silent: true }, makeDeps());
    expect(stdout).toBe('');
  });
});
