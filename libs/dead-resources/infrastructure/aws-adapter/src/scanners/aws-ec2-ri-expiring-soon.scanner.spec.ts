// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeReservedInstancesCommand } from '@aws-sdk/client-ec2';
import { AwsEc2RiExpiringSoonScanner } from './aws-ec2-ri-expiring-soon.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

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
const scanner = new AwsEc2RiExpiringSoonScanner();
const soonDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
const farDate = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);

describe('AwsEc2RiExpiringSoonScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-ri-expiring-soon');
  });

  it('flags an active RI expiring within the window', async () => {
    mockSend.mockResolvedValueOnce({
      ReservedInstances: [
        { ReservedInstancesId: 'ri-1', InstanceType: 'm5.large', InstanceCount: 2, End: soonDate, State: 'active' },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.id)).toEqual(['ri-1']);
    expect(result.value[0].instanceCount).toBe(2);
  });

  it('does not flag an RI expiring well beyond the window', async () => {
    mockSend.mockResolvedValueOnce({
      ReservedInstances: [{ ReservedInstancesId: 'ri-2', InstanceType: 'm5.large', End: farDate, State: 'active' }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report an RI tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      ReservedInstances: [
        {
          ReservedInstancesId: 'ri-keep',
          InstanceType: 'm5.large',
          End: soonDate,
          State: 'active',
          Tags: [{ Key: 'cloudrift:ignore', Value: '' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('filters server-side to active RIs', async () => {
    mockSend.mockResolvedValueOnce({ ReservedInstances: [] });

    await scanner.scan(region);

    const args = (DescribeReservedInstancesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'state', Values: ['active'] }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys the client on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EC2');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
