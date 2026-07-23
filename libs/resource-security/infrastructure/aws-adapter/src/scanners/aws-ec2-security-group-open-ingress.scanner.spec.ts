// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { AwsEc2SecurityGroupOpenIngressScanner } from './aws-ec2-security-group-open-ingress.scanner';
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
const scanner = new AwsEc2SecurityGroupOpenIngressScanner();

describe('AwsEc2SecurityGroupOpenIngressScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-security-group-open-ingress');
  });

  it('flags a security group with SSH open to the internet', async () => {
    mockSend.mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-1',
          GroupName: 'web',
          IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['sg-1']);
  });

  it('flags a security group open to the internet on all ports (protocol -1)', async () => {
    mockSend.mockResolvedValueOnce({
      SecurityGroups: [
        { GroupId: 'sg-2', GroupName: 'all-open', IpPermissions: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a security group restricted to a private CIDR', async () => {
    mockSend.mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-3',
          GroupName: 'internal',
          IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '10.0.0.0/16' }] }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a security group open to the internet on a non-sensitive port', async () => {
    mockSend.mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-4',
          GroupName: 'web-http',
          IpPermissions: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeSecurityGroupsCommand', async () => {
    mockSend.mockResolvedValueOnce({ SecurityGroups: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeSecurityGroupsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
