import { FindStoppedRdsInstancesUseCase } from './find-stopped-rds-instances.use-case';
import { AwsRegion, RdsInstance, RdsInstanceRepositoryPort } from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

function makeInstance(id: string, region = 'us-east-1'): RdsInstance {
  return new RdsInstance({
    dbInstanceIdentifier: id,
    region: AwsRegion.create(region),
    accountId: '123456789012',
    dbInstanceClass: 'db.t3.micro',
    engine: 'mysql',
    dbInstanceStatus: 'stopped',
    allocatedStorageGb: 20,
    storageType: 'gp2',
    multiAZ: false,
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 2.3,
  });
}

function makeRepo(
  impl: RdsInstanceRepositoryPort['findStoppedInstances'],
): RdsInstanceRepositoryPort {
  return { findStoppedInstances: impl };
}

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');

describe('FindStoppedRdsInstancesUseCase', () => {
  it('returns empty list when no stopped instances', async () => {
    const repo = makeRepo(async () => Result.ok([]));
    const result = await new FindStoppedRdsInstancesUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('aggregates instances across regions', async () => {
    const repo = makeRepo(async (region) =>
      Result.ok([makeInstance('db-' + region.code, region.code)]),
    );
    const result = await new FindStoppedRdsInstancesUseCase(repo).execute([usEast1, euWest1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('propagates repository failure', async () => {
    const err = new Error('RDS API error');
    const repo = makeRepo(async () => Result.fail(err));
    const result = await new FindStoppedRdsInstancesUseCase(repo).execute([usEast1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(err);
  });
});
