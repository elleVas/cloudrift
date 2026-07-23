// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CostComparisonSummary } from 'cost-analytics-domain';
import type { CostAnalyticsMeta } from 'cost-analytics-application';
import { generateCostComparisonPdf } from './cost-comparison.pdf-formatter';

const meta: CostAnalyticsMeta = { accountId: '123456789012', generatedAt: new Date('2026-07-22T12:00:00Z') };

const summary: CostComparisonSummary = {
  current: { start: '2026-07-01', end: '2026-07-23', totalUsd: 1378.56 },
  previous: { start: '2026-06-01', end: '2026-06-23', totalUsd: 150.6 },
  changeUsd: 1227.96,
  changePercent: 815.3,
  byService: [
    { service: 'Amazon Redshift', currentUsd: 947.54, previousUsd: 0, changeUsd: 947.54, changePercent: null },
    { service: 'Amazon Elastic Compute Cloud - Compute', currentUsd: 210.12, previousUsd: 150.6, changeUsd: 59.52, changePercent: 39.5 },
    { service: 'Amazon Neptune', currentUsd: 83.95, previousUsd: 0, changeUsd: 83.95, changePercent: null },
  ],
};

describe('generateCostComparisonPdf', () => {
  it('completes without throwing for a realistic summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'cost.pdf');
    try {
      await expect(generateCostComparisonPdf(summary, meta, file)).resolves.toBeUndefined();
      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(written.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing when byService is empty', async () => {
    const empty: CostComparisonSummary = {
      current: { start: '2026-07-01', end: '2026-07-23', totalUsd: 0 },
      previous: { start: '2026-06-01', end: '2026-06-23', totalUsd: 0 },
      changeUsd: 0,
      changePercent: null,
      byService: [],
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'empty.pdf');
    try {
      await expect(generateCostComparisonPdf(empty, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
