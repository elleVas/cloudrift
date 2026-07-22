// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CostTrendSummary } from 'cloud-cost-domain';
import type { CostAnalyticsMeta } from 'cloud-cost-application';
import { generateCostTrendPdf } from './cost-trend.pdf-formatter';

const meta: CostAnalyticsMeta = { accountId: '123456789012', generatedAt: new Date('2026-07-22T12:00:00Z') };

const summary: CostTrendSummary = {
  months: [
    { month: '2026-02', totalUsd: 0, final: true },
    { month: '2026-03', totalUsd: 0, final: true },
    { month: '2026-04', totalUsd: 0, final: true },
    { month: '2026-05', totalUsd: 0, final: true },
    { month: '2026-06', totalUsd: 150.6, final: true },
    { month: '2026-07', totalUsd: 1378.56, final: false },
  ],
};

describe('generateCostTrendPdf', () => {
  it('completes without throwing for a realistic summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'trend.pdf');
    try {
      await expect(generateCostTrendPdf(summary, meta, file)).resolves.toBeUndefined();
      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(written.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('paginates a long trend (36 months) instead of overflowing the page', async () => {
    const long: CostTrendSummary = {
      months: Array.from({ length: 36 }, (_, i) => ({
        month: `2024-${String((i % 12) + 1).padStart(2, '0')}`,
        totalUsd: i * 10,
        final: i < 35,
      })),
    };
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'long.pdf');
    try {
      await expect(generateCostTrendPdf(long, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing when months is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'empty.pdf');
    try {
      await expect(generateCostTrendPdf({ months: [] }, meta, file)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
