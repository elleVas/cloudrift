// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { AwsEc2SecurityGroupUnusedScanner } from './aws-ec2-security-group-unused.scanner';
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
const scanner = new AwsEc2SecurityGroupUnusedScanner();

/** DescribeSecurityGroups -> DescribeNetworkInterfaces, in that Promise.all array order. */
function queue(groups: unknown[], enis: unknown[]): void {
  mockSend.mockResolvedValueOnce({ SecurityGroups: groups }).mockResolvedValueOnce({ NetworkInterfaces: enis });
}

describe('AwsEc2SecurityGroupUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-security-group-unused');
  });

  it('flags a security group not referenced by any network interface', async () => {
    queue([{ GroupId: 'sg-1', GroupName: 'unused-sg' }], []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((g) => g.id)).toEqual(['sg-1']);
  });

  it('does not flag a security group referenced by a network interface', async () => {
    queue([{ GroupId: 'sg-2', GroupName: 'used-sg' }], [{ Groups: [{ GroupId: 'sg-2' }] }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('never flags the default security group', async () => {
    queue([{ GroupId: 'sg-3', GroupName: 'default' }], []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a security group tagged cloudrift:ignore', async () => {
    queue([{ GroupId: 'sg-keep', GroupName: 'keep-sg', Tags: [{ Key: 'cloudrift:ignore', Value: '' }] }], []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeSecurityGroupsCommand', async () => {
    queue([], []);

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeSecurityGroupsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
