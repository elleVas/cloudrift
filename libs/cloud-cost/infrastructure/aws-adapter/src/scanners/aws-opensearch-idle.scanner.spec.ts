// SPDX-License-Identifier: Apache-2.0
import { OpenSearchClient } from '@aws-sdk/client-opensearch';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { AwsOpenSearchIdleScanner } from './aws-opensearch-idle.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-opensearch');
jest.mock('@aws-sdk/client-cloudwatch');

const mockOsSend = jest.fn();
const mockOsDestroy = jest.fn();
const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (OpenSearchClient as jest.Mock).mockImplementation(() => ({ send: mockOsSend, destroy: mockOsDestroy }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: mockCwDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getOpenSearchInstancePricePerMonth: jest.fn().mockResolvedValue(50) };
const scanner = new AwsOpenSearchIdleScanner(mockPricingSource, 'acct-1');

function mockDomain(name: string, instanceCount = 1) {
  mockOsSend.mockResolvedValueOnce({ DomainNames: [{ DomainName: name }] });
  mockOsSend.mockResolvedValueOnce({
    DomainStatusList: [{ DomainName: name, ClusterConfig: { InstanceType: 'r6g.large.search', InstanceCount: instanceCount } }],
  });
}

describe('AwsOpenSearchIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('opensearch-idle-domain');
  });

  it('reports a domain with zero search/indexing traffic', async () => {
    mockDomain('domain-1', 2);
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((d) => d.id)).toEqual(['domain-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(50 * 2, 2);
  });

  it('does not report a domain with traffic', async () => {
    mockDomain('busy-domain');
    mockCwSend.mockResolvedValueOnce({ Datapoints: [{ Sum: 10 }] }).mockResolvedValueOnce({ Datapoints: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips CloudWatch entirely when no domains exist', async () => {
    mockOsSend.mockResolvedValueOnce({ DomainNames: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('queries SearchRate/IndexingRate from the AWS/ES namespace, dimensioned by ClientId+DomainName', async () => {
    mockDomain('domain-1');
    mockCwSend.mockResolvedValueOnce({ Datapoints: [] }).mockResolvedValueOnce({ Datapoints: [] });

    await scanner.scan(region);

    const calls = (GetMetricStatisticsCommand as unknown as jest.Mock).mock.calls;
    expect(calls[0][0].Namespace).toBe('AWS/ES');
    expect(calls[0][0].MetricName).toBe('SearchRate');
    expect(calls[0][0].Dimensions).toEqual([
      { Name: 'ClientId', Value: 'acct-1' },
      { Name: 'DomainName', Value: 'domain-1' },
    ]);
    expect(calls[1][0].MetricName).toBe('IndexingRate');
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys both clients on error', async () => {
    mockOsSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('OpenSearch');
    expect(mockOsDestroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
