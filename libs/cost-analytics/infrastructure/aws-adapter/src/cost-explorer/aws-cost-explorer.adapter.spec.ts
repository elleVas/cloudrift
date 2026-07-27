// SPDX-License-Identifier: Apache-2.0
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { AwsCostExplorerAdapter } from './aws-cost-explorer.adapter';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-cost-explorer');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CostExplorerClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const adapter = new AwsCostExplorerAdapter();
const params = { startDate: '2026-07-01', endDate: '2026-07-27', granularity: 'DAILY' as const };

describe('AwsCostExplorerAdapter', () => {
  it('returns an empty list when AWS returns no results', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('treats a missing ResultsByTime as an empty page', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('defaults missing Groups, Metrics/Amount and TimePeriod fields', async () => {
    mockSend.mockResolvedValueOnce({
      ResultsByTime: [{}],
    });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { start: '', end: '', totalUsd: 0, byService: [], final: true },
    ]);
  });

  it('defaults a missing Amount to 0 for a group that otherwise has a service key', async () => {
    mockSend.mockResolvedValueOnce({
      ResultsByTime: [
        { TimePeriod: { Start: '2026-07-01', End: '2026-07-02' }, Groups: [{ Keys: ['Amazon EC2'] }] },
      ],
    });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].byService).toEqual([]);
  });

  it('maps a ResultByTime into a CostPeriodBucket, filtering zero-amount services', async () => {
    mockSend.mockResolvedValueOnce({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2026-07-01', End: '2026-07-02' },
          Estimated: false,
          Groups: [
            { Keys: ['Amazon EC2'], Metrics: { UnblendedCost: { Amount: '12.50' } } },
            { Keys: ['Amazon S3'], Metrics: { UnblendedCost: { Amount: '0' } } },
          ],
        },
      ],
    });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        start: '2026-07-01',
        end: '2026-07-02',
        totalUsd: 12.5,
        byService: [{ service: 'Amazon EC2', amountUsd: 12.5 }],
        final: true,
      },
    ]);
  });

  it('marks a bucket as not final when AWS flags it as Estimated', async () => {
    mockSend.mockResolvedValueOnce({
      ResultsByTime: [
        { TimePeriod: { Start: '2026-07-27', End: '2026-07-28' }, Estimated: true, Groups: [] },
      ],
    });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].final).toBe(false);
  });

  it('defaults a missing service key to "Unknown"', async () => {
    mockSend.mockResolvedValueOnce({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2026-07-01', End: '2026-07-02' },
          Groups: [{ Keys: undefined, Metrics: { UnblendedCost: { Amount: '5' } } }],
        },
      ],
    });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].byService).toEqual([{ service: 'Unknown', amountUsd: 5 }]);
  });

  it('follows NextPageToken across multiple pages and aggregates all results', async () => {
    mockSend
      .mockResolvedValueOnce({
        ResultsByTime: [{ TimePeriod: { Start: '2026-07-01', End: '2026-07-02' }, Groups: [] }],
        NextPageToken: 'cursor-2',
      })
      .mockResolvedValueOnce({
        ResultsByTime: [{ TimePeriod: { Start: '2026-07-02', End: '2026-07-03' }, Groups: [] }],
      });

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((b) => b.start)).toEqual(['2026-07-01', '2026-07-02']);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const secondCallArgs = (GetCostAndUsageCommand as unknown as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.NextPageToken).toBe('cursor-2');
  });

  it('sends GetCostAndUsageCommand with the requested params', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    await adapter.getCostAndUsage(params);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetCostAndUsageCommand));
    const constructorArgs = (GetCostAndUsageCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.TimePeriod).toEqual({ Start: params.startDate, End: params.endDate });
    expect(constructorArgs.Granularity).toBe('DAILY');
  });

  it('destroys the client after the call', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    await adapter.getCostAndUsage(params);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('throttled'));

    const result = await adapter.getCostAndUsage(params);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('CostExplorer');
    }
  });

  it('still destroys the client after a failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));

    await adapter.getCostAndUsage(params);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
