// SPDX-License-Identifier: Apache-2.0
import { EC2Client } from '@aws-sdk/client-ec2';
import { AwsEc2DefaultSecurityGroupPermissiveScanner } from './aws-ec2-default-security-group-permissive.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEc2DefaultSecurityGroupPermissiveScanner();

describe('AwsEc2DefaultSecurityGroupPermissiveScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-default-security-group-permissive');
  });

  it('flags a default security group carrying ingress rules', async () => {
    mockSend.mockResolvedValueOnce({
      SecurityGroups: [{ GroupId: 'sg-default-1', VpcId: 'vpc-1', IpPermissions: [{ IpProtocol: '-1' }], IpPermissionsEgress: [] }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['sg-default-1']);
  });

  it('does not flag a default security group with no rules at all', async () => {
    mockSend.mockResolvedValueOnce({
      SecurityGroups: [{ GroupId: 'sg-default-2', VpcId: 'vpc-2', IpPermissions: [], IpPermissionsEgress: [] }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
