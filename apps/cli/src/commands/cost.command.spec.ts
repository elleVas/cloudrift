// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { CostExplorerPort, CostPeriodBucket } from 'cloud-cost-domain';
import type { CloudriftConfig } from '../config/cloudrift.config';
import { costCommand, type CostCommandOptions } from './cost.command';
import type { CostAnalyticsDeps } from './cost-analytics.composition';

/**
 * Generates one bucket per requested day: `amountForDay` decides its total.
 * The command (unlike the use-case spec) never injects `today`, so a fixed
 * calendar date baked into test fixtures would drift and eventually land on
 * the wrong side of the current/previous boundary — this fake instead reacts
 * to whatever range `CompareCostUseCase` actually asks for, exactly like the
 * real AWS adapter would.
 */
function dynamicDailyPort(amountForDay: (ymd: string) => number): CostExplorerPort {
  return {
    getCostAndUsage: async (params) => {
      const buckets: CostPeriodBucket[] = [];
      let cursor = new Date(`${params.startDate}T00:00:00Z`);
      const end = new Date(`${params.endDate}T00:00:00Z`);
      while (cursor < end) {
        const start = cursor.toISOString().slice(0, 10);
        const amountUsd = amountForDay(start);
        cursor = new Date(cursor.getTime() + 86_400_000);
        buckets.push({
          start,
          end: cursor.toISOString().slice(0, 10),
          totalUsd: amountUsd,
          byService: amountUsd !== 0 ? [{ service: 'EC2', amountUsd }] : [],
          final: true,
        });
      }
      return Result.ok(buckets);
    },
  };
}

function makeDeps(opts: { config?: CloudriftConfig; port?: CostExplorerPort } = {}): CostAnalyticsDeps {
  const port = opts.port ?? dynamicDailyPort(() => 0);
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

function run(options: Partial<CostCommandOptions>, deps: CostAnalyticsDeps): Promise<void> {
  return costCommand({ ...options }, deps);
}

describe('costCommand (CLI end-to-end)', () => {
  it('rejects an invalid --format before doing any work (exit 1)', async () => {
    await run({ format: 'xml' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--format must be one of');
  });

  it('rejects a negative --fail-on-increase', async () => {
    await run({ failOnIncrease: '-5' }, makeDeps());
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--fail-on-increase must be a non-negative number');
  });

  it('table format: renders the comparison to stdout', async () => {
    await run({ format: 'table' }, makeDeps());
    expect(stdout).toContain('Cost comparison');
  });

  it('json format: stdout is pure parseable JSON', async () => {
    await run({ format: 'json' }, makeDeps());
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.current).toBeDefined();
    expect(parsed.previous).toBeDefined();
  });

  it('exits 2 via --fail-on-increase when the last two weeks spiked vs. a quiet baseline', async () => {
    const today = new Date();
    const recencyCutoff = new Date(today.getTime() - 15 * 86_400_000).toISOString().slice(0, 10);
    const port = dynamicDailyPort((ymd) => (ymd >= recencyCutoff ? 1000 : 10));

    await run({ format: 'json', failOnIncrease: '5' }, makeDeps({ port }));
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain('Spend increase threshold exceeded');
  });

  it('a low config threshold is overridden by an explicit --fail-on-increase', async () => {
    await run(
      { format: 'json', failOnIncrease: '999999' },
      makeDeps({ config: { costIncreaseAlertPercent: 0 }, port: dynamicDailyPort(() => 10) }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('does not gate when neither --fail-on-increase nor config set a threshold', async () => {
    await run({ format: 'json' }, makeDeps());
    expect(process.exitCode).toBeUndefined();
  });

  it('--silent suppresses stdout entirely', async () => {
    await run({ format: 'table', silent: true }, makeDeps());
    expect(stdout).toBe('');
  });
});
