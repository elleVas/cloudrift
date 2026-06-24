// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeAddressesCommand } from '@aws-sdk/client-ec2';
import { AwsElasticIpScanner } from './aws-elastic-ip.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsElasticIpScanner(mockPricing);

describe('AwsElasticIpScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('elastic-ip');
  });

  it('returns only unassociated addresses', async () => {
    mockSend.mockResolvedValueOnce({
      Addresses: [
        { AllocationId: 'eipalloc-1', PublicIp: '1.1.1.1' },
        { AllocationId: 'eipalloc-2', PublicIp: '2.2.2.2', AssociationId: 'assoc-1' },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((ip) => ip.id)).toEqual(['eipalloc-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(3.6, 2);
  });

  it('does not report an address tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      Addresses: [
        {
          AllocationId: 'eipalloc-keep',
          PublicIp: '3.3.3.3',
          Tags: [{ Key: 'cloudrift:ignore', Value: '' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeAddressesCommand with vpc domain filter', async () => {
    mockSend.mockResolvedValueOnce({ Addresses: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeAddressesCommand));
    const constructorArgs = (DescribeAddressesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([{ Name: 'domain', Values: ['vpc'] }]);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
