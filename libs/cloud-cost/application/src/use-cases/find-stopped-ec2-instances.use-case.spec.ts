import { FindStoppedEc2InstancesUseCase } from './find-stopped-ec2-instances.use-case';
import { AwsRegion, Ec2Instance, Ec2InstanceRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeInstance(id: string, region = 'us-east-1'): Ec2Instance {
  return new Ec2Instance({
    instanceId: id,
    region: AwsRegion.create(region),
    accountId: '123456789012',
    instanceType: 't3.medium',
    state: 'stopped',
    launchTime: new Date('2024-01-01'),
    detectedAt: new Date('2026-06-09'),
    attachedVolumes: [{ volumeId: 'vol-001', sizeGb: 20, volumeType: 'gp3' }],
    tags: {},
    monthlyCostUsd: 1.6,
  });
}

function makeRepo(
  impl: Ec2InstanceRepositoryPort['findStoppedInstances'],
): Ec2InstanceRepositoryPort {
  return { findStoppedInstances: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindStoppedEc2InstancesUseCase', () => {
  it('returns empty list when no stopped instances', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const result = await new FindStoppedEc2InstancesUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates instances across regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeInstance('i-' + region.code, region.code)]),
    );
    const result = await new FindStoppedEc2InstancesUseCase(repo).execute([usEast1, euWest1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('propagates repository failure', async () => {
    const err = new Error('EC2 API error');
    const repo = makeRepo(async () => Result.fail(err));
    const result = await new FindStoppedEc2InstancesUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
  });
});
