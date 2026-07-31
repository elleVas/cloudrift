// SPDX-License-Identifier: Apache-2.0
import { RedshiftClient, DescribeClustersCommand } from '@aws-sdk/client-redshift';
import { AwsRedshiftClusterPubliclyAccessibleScanner } from './aws-redshift-cluster-publicly-accessible.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-redshift');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (RedshiftClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsRedshiftClusterPubliclyAccessibleScanner();

describe('AwsRedshiftClusterPubliclyAccessibleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('redshift-cluster-publicly-accessible');
  });

  it('flags a publicly accessible cluster', async () => {
    mockSend.mockResolvedValueOnce({ Clusters: [{ ClusterIdentifier: 'cluster-1', PubliclyAccessible: true }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a private cluster', async () => {
    mockSend.mockResolvedValueOnce({ Clusters: [{ ClusterIdentifier: 'cluster-1', PubliclyAccessible: false }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeClustersCommand', async () => {
    mockSend.mockResolvedValueOnce({ Clusters: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeClustersCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
