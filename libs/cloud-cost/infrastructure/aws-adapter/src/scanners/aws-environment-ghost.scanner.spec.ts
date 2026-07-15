// SPDX-License-Identifier: Apache-2.0
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { AwsEnvironmentGhostScanner } from './aws-environment-ghost.scanner';
import { AwsRegion, EnvironmentGhostPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-resource-groups-tagging-api');
jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-rds');
jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-elastic-load-balancing-v2');
jest.mock('@aws-sdk/client-cloudwatch');

const mockTaggingSend = jest.fn();
const mockEc2Send = jest.fn();
const mockRdsSend = jest.fn();
const mockLambdaSend = jest.fn();
const mockElbSend = jest.fn();
const mockCwSend = jest.fn();
const destroyMocks = {
  tagging: jest.fn(),
  ec2: jest.fn(),
  rds: jest.fn(),
  lambda: jest.fn(),
  elb: jest.fn(),
  cw: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (ResourceGroupsTaggingAPIClient as jest.Mock).mockImplementation(() => ({ send: mockTaggingSend, destroy: destroyMocks.tagging }));
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockEc2Send, destroy: destroyMocks.ec2 }));
  (RDSClient as jest.Mock).mockImplementation(() => ({ send: mockRdsSend, destroy: destroyMocks.rds }));
  (LambdaClient as jest.Mock).mockImplementation(() => ({ send: mockLambdaSend, destroy: destroyMocks.lambda }));
  (ElasticLoadBalancingV2Client as jest.Mock).mockImplementation(() => ({ send: mockElbSend, destroy: destroyMocks.elb }));
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockCwSend, destroy: destroyMocks.cw }));
  // Safe "nothing here" defaults; tests override the calls they care about.
  mockTaggingSend.mockResolvedValue({ ResourceTagMappingList: [] });
  mockEc2Send.mockResolvedValue({ Reservations: [] });
  mockRdsSend.mockResolvedValue({ DBInstances: [] });
  mockLambdaSend.mockResolvedValue({ Functions: [] });
  mockElbSend.mockResolvedValue({ LoadBalancers: [] });
});

const region = AwsRegion.create('us-east-1');
const OLD_TRANSITION = 'User initiated (2020-01-15 08:00:00 GMT)';

function scanner(inactivityDays = 0, tagKeys = ['Environment']) {
  return new AwsEnvironmentGhostScanner(
    '000000000000',
    new EnvironmentGhostPolicy({}, inactivityDays),
    tagKeys,
    undefined,
    inactivityDays,
  );
}

describe('AwsEnvironmentGhostScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner().kind).toBe('environment-ghost');
  });

  it('reports a tagged environment whose only resource (EC2) is stopped', async () => {
    mockTaggingSend.mockResolvedValueOnce({
      ResourceTagMappingList: [
        { ResourceARN: 'arn:aws:ec2:us-east-1:000000000000:instance/i-0abc', Tags: [{ Key: 'Environment', Value: 'pr-1234' }] },
      ],
    });
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: 'i-0abc',
              State: { Name: 'stopped' },
              StateTransitionReason: OLD_TRANSITION,
              LaunchTime: new Date('2019-01-01'),
              Tags: [{ Key: 'Environment', Value: 'pr-1234' }],
            },
          ],
        },
      ],
    });

    const result = await scanner().scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((f) => f.id)).toEqual(['pr-1234']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBe(0);
  });

  it('does not report a group where at least one resource is still active', async () => {
    mockTaggingSend.mockResolvedValueOnce({
      ResourceTagMappingList: [
        { ResourceARN: 'arn:aws:ec2:us-east-1:000000000000:instance/i-0abc', Tags: [{ Key: 'Environment', Value: 'pr-1234' }] },
        { ResourceARN: 'arn:aws:rds:us-east-1:000000000000:db:pr-1234-db', Tags: [{ Key: 'Environment', Value: 'pr-1234' }] },
      ],
    });
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            { InstanceId: 'i-0abc', State: { Name: 'stopped' }, StateTransitionReason: OLD_TRANSITION, LaunchTime: new Date('2019-01-01'), Tags: [] },
          ],
        },
      ],
    });
    mockRdsSend.mockResolvedValueOnce({
      DBInstances: [
        { DBInstanceArn: 'arn:aws:rds:us-east-1:000000000000:db:pr-1234-db', DBInstanceIdentifier: 'pr-1234-db', DBInstanceStatus: 'available', InstanceCreateTime: new Date('2019-01-01') },
      ],
    });

    const result = await scanner().scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('falls back to naming-pattern detection for an untagged resource matching a configured pattern', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: 'i-0xyz',
              State: { Name: 'stopped' },
              StateTransitionReason: OLD_TRANSITION,
              LaunchTime: new Date('2019-01-01'),
              Tags: [{ Key: 'Name', Value: 'myapp-pr-5678-web' }],
            },
          ],
        },
      ],
    });

    const result = await scanner().scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((f) => f.id)).toEqual(['myapp-pr-5678-web']);
    expect((result.value[0] as unknown as { detectionMethod: string }).detectionMethod).toBe('naming-pattern');
  });

  it('does not report a group within the inactivity grace period', async () => {
    mockTaggingSend.mockResolvedValueOnce({
      ResourceTagMappingList: [
        { ResourceARN: 'arn:aws:ec2:us-east-1:000000000000:instance/i-0abc', Tags: [{ Key: 'Environment', Value: 'pr-1234' }] },
      ],
    });
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: 'i-0abc',
              State: { Name: 'stopped' },
              StateTransitionReason: `User initiated (${new Date().toISOString().slice(0, 19).replace('T', ' ')} GMT)`,
              LaunchTime: new Date(),
              Tags: [],
            },
          ],
        },
      ],
    });

    const result = await scanner(7).scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys every client on error', async () => {
    mockTaggingSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner().scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('ResourceGroupsTaggingAPI');
    expect(destroyMocks.tagging).toHaveBeenCalledTimes(1);
    expect(destroyMocks.ec2).toHaveBeenCalledTimes(1);
    expect(destroyMocks.rds).toHaveBeenCalledTimes(1);
    expect(destroyMocks.lambda).toHaveBeenCalledTimes(1);
    expect(destroyMocks.elb).toHaveBeenCalledTimes(1);
    expect(destroyMocks.cw).toHaveBeenCalledTimes(1);
  });
});
