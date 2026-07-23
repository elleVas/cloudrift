// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListInstanceProfilesCommand } from '@aws-sdk/client-iam';
import { EC2Client, DescribeRegionsCommand, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { AwsIamInstanceProfileUnattachedScanner } from './aws-iam-instance-profile-unattached.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-iam');
jest.mock('@aws-sdk/client-ec2');

const mockIamSend = jest.fn();
const mockEc2Send = jest.fn();
const mockDestroy = jest.fn();

/** Region-keyed EC2 responses — DescribeInstances is called once per enabled region, via a fresh EC2Client bound to that region. */
let ec2ResponsesByRegion: Record<string, { Instances?: unknown[] }>;
let enabledRegionNames: string[];

beforeEach(() => {
  jest.clearAllMocks();
  ec2ResponsesByRegion = {};
  enabledRegionNames = ['us-east-1'];

  (IAMClient as jest.Mock).mockImplementation(() => ({ send: mockIamSend, destroy: mockDestroy }));
  (EC2Client as jest.Mock).mockImplementation((config: { region: string }) => ({
    send: async (command: unknown) => {
      if (command instanceof DescribeRegionsCommand) {
        return { Regions: enabledRegionNames.map((RegionName) => ({ RegionName })) };
      }
      if (command instanceof DescribeInstancesCommand) {
        const instances = ec2ResponsesByRegion[config.region]?.Instances ?? [];
        return { Reservations: [{ Instances: instances }] };
      }
      return mockEc2Send(command, config.region);
    },
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsIamInstanceProfileUnattachedScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

describe('AwsIamInstanceProfileUnattachedScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-instance-profile-unattached');
    expect(scanner.scope).toBe('global');
  });

  it('flags an instance profile not attached to any instance in any enabled region', async () => {
    mockIamSend.mockResolvedValueOnce({
      InstanceProfiles: [
        { InstanceProfileId: 'AIPA1', InstanceProfileName: 'unused-profile', Arn: 'arn:aws:iam::123:instance-profile/unused-profile', CreateDate: oldDate },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.id)).toEqual(['AIPA1']);
  });

  it('does not flag an instance profile attached to an instance in a non-default enabled region', async () => {
    enabledRegionNames = ['us-east-1', 'eu-west-1'];
    ec2ResponsesByRegion['eu-west-1'] = {
      Instances: [{ State: { Name: 'running' }, IamInstanceProfile: { Arn: 'arn:aws:iam::123:instance-profile/cross-region-profile' } }],
    };
    mockIamSend.mockResolvedValueOnce({
      InstanceProfiles: [
        { InstanceProfileId: 'AIPA2', InstanceProfileName: 'cross-region-profile', Arn: 'arn:aws:iam::123:instance-profile/cross-region-profile', CreateDate: oldDate },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores terminated instances when checking attachment', async () => {
    ec2ResponsesByRegion['us-east-1'] = {
      Instances: [{ State: { Name: 'terminated' }, IamInstanceProfile: { Arn: 'arn:aws:iam::123:instance-profile/terminated-only' } }],
    };
    mockIamSend.mockResolvedValueOnce({
      InstanceProfiles: [
        { InstanceProfileId: 'AIPA3', InstanceProfileName: 'terminated-only', Arn: 'arn:aws:iam::123:instance-profile/terminated-only', CreateDate: oldDate },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.id)).toEqual(['AIPA3']);
  });

  it('sends ListInstanceProfilesCommand', async () => {
    mockIamSend.mockResolvedValueOnce({ InstanceProfiles: [] });

    await scanner.scan(region);

    expect(mockIamSend).toHaveBeenCalledWith(expect.any(ListInstanceProfilesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListInstanceProfiles fails and destroys the clients', async () => {
    mockIamSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalled();
  });
});
