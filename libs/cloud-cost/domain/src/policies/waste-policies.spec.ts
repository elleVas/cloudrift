// SPDX-License-Identifier: Apache-2.0
import { EbsVolumeWastePolicy } from './ebs-volume.policy';
import { ElasticIpWastePolicy } from './elastic-ip.policy';
import { RdsInstanceWastePolicy } from './rds-instance.policy';
import { LoadBalancerWastePolicy } from './load-balancer.policy';
import { Ec2InstanceWastePolicy } from './ec2-instance.policy';
import { EbsSnapshotWastePolicy } from './ebs-snapshot.policy';
import { NatGatewayWastePolicy } from './nat-gateway.policy';
import { EbsGp2UpgradePolicy } from './gp2-volume.policy';
import { EbsIdlePolicy } from './idle-ebs-volume.policy';
import { Ec2UnderutilizedPolicy } from './underutilized-ec2-instance.policy';
import { RdsUnderutilizedPolicy } from './rds-underutilized-instance.policy';
import { LogGroupWastePolicy } from './log-group.policy';
import { OrphanedEniWastePolicy } from './orphaned-eni.policy';
import { S3NoLifecyclePolicy } from './s3-bucket.policy';
import { LambdaUnderutilizedPolicy } from './underutilized-lambda-function.policy';
import { EfsUnusedPolicy } from './efs-file-system.policy';
import { DynamoDbOverprovisionedPolicy } from './overprovisioned-dynamodb-table.policy';
import { ElastiCacheIdlePolicy } from './idle-elasticache-cluster.policy';
import { AmiUnusedPolicy } from './ami-unused.policy';
import { EcrImageUntaggedPolicy } from './ecr-image-untagged.policy';
import { S3MultipartUploadAbandonedPolicy } from './s3-multipart-upload-abandoned.policy';
import { RdsManualSnapshotOldPolicy } from './rds-manual-snapshot-old.policy';
import { SecretsManagerUnusedPolicy } from './secretsmanager-unused.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './waste-policy';
import { EbsVolume } from '../entities/ebs-volume.entity';
import { ElasticIp } from '../entities/elastic-ip.entity';
import { RdsInstance } from '../entities/rds-instance.entity';
import { LoadBalancer } from '../entities/load-balancer.entity';
import { Ec2Instance } from '../entities/ec2-instance.entity';
import { EbsSnapshot } from '../entities/ebs-snapshot.entity';
import { NatGateway } from '../entities/nat-gateway.entity';
import { Gp2Volume } from '../entities/gp2-volume.entity';
import { IdleEbsVolume } from '../entities/idle-ebs-volume.entity';
import { UnderutilizedEc2Instance } from '../entities/underutilized-ec2-instance.entity';
import type { UnderutilizedEc2InstanceProps } from '../entities/underutilized-ec2-instance.entity';
import { RdsUnderutilizedInstance } from '../entities/rds-underutilized-instance.entity';
import type { RdsUnderutilizedInstanceProps } from '../entities/rds-underutilized-instance.entity';
import { LogGroup } from '../entities/log-group.entity';
import { OrphanedEni } from '../entities/orphaned-eni.entity';
import { S3Bucket } from '../entities/s3-bucket.entity';
import { UnderutilizedLambdaFunction } from '../entities/underutilized-lambda-function.entity';
import { EfsFileSystem } from '../entities/efs-file-system.entity';
import { OverprovisionedDynamoDbTable } from '../entities/overprovisioned-dynamodb-table.entity';
import { IdleElastiCacheCluster } from '../entities/idle-elasticache-cluster.entity';
import { AmiUnused } from '../entities/ami-unused.entity';
import { EcrImageUntagged } from '../entities/ecr-image-untagged.entity';
import { S3MultipartUploadAbandoned } from '../entities/s3-multipart-upload-abandoned.entity';
import { RdsManualSnapshotOld } from '../entities/rds-manual-snapshot-old.entity';
import { SecretsManagerUnused } from '../entities/secretsmanager-unused.entity';
import type { EbsSnapshotProps } from '../entities/ebs-snapshot.entity';
import type { Ec2InstanceProps } from '../entities/ec2-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');
const now = new Date('2026-06-12T00:00:00Z');
const oldDate = new Date('2025-01-01');
const yesterday = new Date('2026-06-11T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Exactly `DEFAULT_MIN_AGE_DAYS` before `now` — the exact boundary of the grace period. */
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeVolume(overrides: { createTime?: Date; tags?: Record<string, string>; state?: 'available' | 'in-use' } = {}): EbsVolume {
  return new EbsVolume({
    volumeId: 'vol-1',
    region,
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state: overrides.state ?? 'available',
    createTime: overrides.createTime ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    monthlyCostUsd: 8,
  });
}

describe('EbsVolumeWastePolicy', () => {
  const policy = new EbsVolumeWastePolicy();

  it('flags an old unattached volume as waste', () => {
    expect(policy.evaluate(makeVolume(), now).isWaste).toBe(true);
  });

  it('does not flag an attached volume', () => {
    expect(policy.evaluate(makeVolume({ state: 'in-use' }), now).isWaste).toBe(false);
  });

  it('does not flag a volume created within the grace period', () => {
    const verdict = policy.evaluate(makeVolume({ createTime: yesterday }), now);
    expect(verdict.isWaste).toBe(false);
    expect(verdict.reason).toContain('7d');
  });

  it('flags a volume created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeVolume({ createTime: exactlyAtMinAge }), now).isWaste).toBe(true);
  });

  it('does not flag a volume carrying the ignore tag', () => {
    const verdict = policy.evaluate(
      makeVolume({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }),
      now,
    );
    expect(verdict.isWaste).toBe(false);
    expect(verdict.reason).toContain(DEFAULT_IGNORE_TAG);
  });

  it('honours a custom grace period', () => {
    const lenient = new EbsVolumeWastePolicy({ minAgeDays: 0 });
    expect(lenient.evaluate(makeVolume({ createTime: yesterday }), now).isWaste).toBe(true);
  });

  it('honours a custom ignore tag', () => {
    const custom = new EbsVolumeWastePolicy({ ignoreTag: 'keep' });
    expect(custom.evaluate(makeVolume({ tags: { keep: '' } }), now).isWaste).toBe(false);
  });
});

describe('WastePolicy excludeTagValues', () => {
  it('excludes a resource whose tag matches an excluded key=value', () => {
    const policy = new EbsVolumeWastePolicy({
      excludeTagValues: { Environment: 'Production' },
    });
    const verdict = policy.evaluate(
      makeVolume({ tags: { Environment: 'Production' } }),
      now,
    );
    expect(verdict.isWaste).toBe(false);
    expect(verdict.reason).toContain('Environment=Production');
  });

  it('does not exclude when the tag value differs', () => {
    const policy = new EbsVolumeWastePolicy({
      excludeTagValues: { Environment: 'Production' },
    });
    expect(
      policy.evaluate(makeVolume({ tags: { Environment: 'Staging' } }), now).isWaste,
    ).toBe(true);
  });

  it('does not exclude when the tag key is absent', () => {
    const policy = new EbsVolumeWastePolicy({
      excludeTagValues: { Environment: 'Production' },
    });
    expect(policy.evaluate(makeVolume({ tags: {} }), now).isWaste).toBe(true);
  });
});

describe('ElasticIpWastePolicy', () => {
  const policy = new ElasticIpWastePolicy();

  function makeIp(associationId?: string, tags: Record<string, string> = {}): ElasticIp {
    return new ElasticIp({
      allocationId: 'eipalloc-1',
      publicIp: '1.2.3.4',
      region,
      accountId: '123456789012',
      detectedAt: now,
      associationId,
      tags,
      monthlyCostUsd: 3.6,
    });
  }

  it('flags an unassociated IP', () => {
    expect(policy.evaluate(makeIp(), now).isWaste).toBe(true);
  });

  it('does not flag an associated IP', () => {
    expect(policy.evaluate(makeIp('assoc-1'), now).isWaste).toBe(false);
  });

  it('does not flag an IP carrying the ignore tag', () => {
    expect(policy.evaluate(makeIp(undefined, { [DEFAULT_IGNORE_TAG]: '' }), now).isWaste).toBe(false);
  });
});

describe('RdsInstanceWastePolicy', () => {
  const policy = new RdsInstanceWastePolicy();

  function makeDb(status: 'stopped' | 'available', tags: Record<string, string> = {}): RdsInstance {
    return new RdsInstance({
      dbInstanceIdentifier: 'db-1',
      region,
      accountId: '123456789012',
      dbInstanceClass: 'db.t3.micro',
      engine: 'postgres',
      dbInstanceStatus: status,
      allocatedStorageGb: 50,
      storageType: 'gp2',
      multiAZ: false,
      detectedAt: now,
      tags,
      monthlyCostUsd: 5.75,
    });
  }

  it('flags a stopped instance', () => {
    expect(policy.evaluate(makeDb('stopped'), now).isWaste).toBe(true);
  });

  it('does not flag a running instance', () => {
    expect(policy.evaluate(makeDb('available'), now).isWaste).toBe(false);
  });

  it('does not flag a stopped instance carrying the ignore tag', () => {
    expect(policy.evaluate(makeDb('stopped', { [DEFAULT_IGNORE_TAG]: '' }), now).isWaste).toBe(false);
  });
});

describe('LoadBalancerWastePolicy', () => {
  const policy = new LoadBalancerWastePolicy();

  function makeLb(registeredTargetCount: number, createdTime = oldDate): LoadBalancer {
    return new LoadBalancer({
      arn: 'arn:lb',
      name: 'my-lb',
      region,
      accountId: '123456789012',
      type: 'application',
      createdTime,
      detectedAt: now,
      registeredTargetCount,
      tags: {},
      monthlyCostUsd: 16.2,
    });
  }

  it('flags an old LB with zero registered targets', () => {
    expect(policy.evaluate(makeLb(0), now).isWaste).toBe(true);
  });

  it('does not flag an LB with registered targets', () => {
    expect(policy.evaluate(makeLb(2), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created LB (grace period)', () => {
    expect(policy.evaluate(makeLb(0, yesterday), now).isWaste).toBe(false);
  });
});

describe('Ec2InstanceWastePolicy', () => {
  const policy = new Ec2InstanceWastePolicy();

  function makeInstance(overrides: Partial<Ec2InstanceProps> = {}): Ec2Instance {
    return new Ec2Instance({
      instanceId: 'i-1',
      region,
      accountId: '123456789012',
      instanceType: 't3.micro',
      state: 'stopped',
      launchTime: oldDate,
      detectedAt: now,
      attachedVolumes: [],
      tags: {},
      monthlyCostUsd: 2,
      ...overrides,
    });
  }

  it('flags an instance stopped long ago', () => {
    expect(policy.evaluate(makeInstance({ stoppedSince: oldDate }), now).isWaste).toBe(true);
  });

  it('does not flag an instance stopped yesterday (grace period)', () => {
    expect(policy.evaluate(makeInstance({ stoppedSince: yesterday }), now).isWaste).toBe(false);
  });

  it('falls back to launchTime when the stop time is unknown', () => {
    expect(policy.evaluate(makeInstance({ launchTime: yesterday }), now).isWaste).toBe(false);
    expect(policy.evaluate(makeInstance({ launchTime: oldDate }), now).isWaste).toBe(true);
  });

  it('does not flag a running instance', () => {
    expect(policy.evaluate(makeInstance({ state: 'running' }), now).isWaste).toBe(false);
  });
});

describe('EbsSnapshotWastePolicy', () => {
  const policy = new EbsSnapshotWastePolicy();

  function makeSnapshot(overrides: Partial<EbsSnapshotProps> = {}): EbsSnapshot {
    return new EbsSnapshot({
      snapshotId: 'snap-1',
      region,
      accountId: '123456789012',
      sourceVolumeId: 'vol-gone',
      sourceVolumeExists: false,
      sizeGb: 100,
      startTime: oldDate,
      detectedAt: now,
      description: '',
      tags: {},
      monthlyCostUsd: 5,
      ...overrides,
    });
  }

  it('flags an old orphan snapshot', () => {
    expect(policy.evaluate(makeSnapshot(), now).isWaste).toBe(true);
  });

  it('does not flag a snapshot whose volume still exists', () => {
    expect(policy.evaluate(makeSnapshot({ sourceVolumeExists: true }), now).isWaste).toBe(false);
  });

  it('does not flag a snapshot referenced by a registered AMI', () => {
    const verdict = policy.evaluate(makeSnapshot({ boundToAmiId: 'ami-1' }), now);
    expect(verdict.isWaste).toBe(false);
    expect(verdict.reason).toContain('ami-1');
  });

  it('does not flag a recent snapshot (grace period)', () => {
    expect(policy.evaluate(makeSnapshot({ startTime: yesterday }), now).isWaste).toBe(false);
  });
});

describe('NatGatewayWastePolicy', () => {
  const policy = new NatGatewayWastePolicy();

  function makeGateway(bytesOutLastWindow: number, createTime = oldDate): NatGateway {
    return new NatGateway({
      natGatewayId: 'nat-1',
      region,
      accountId: '123456789012',
      vpcId: 'vpc-1',
      createTime,
      detectedAt: now,
      bytesOutLastWindow,
      metricWindowHours: 48,
      tags: {},
      monthlyCostUsd: 32.4,
    });
  }

  it('flags an old idle gateway', () => {
    const verdict = policy.evaluate(makeGateway(0), now);
    expect(verdict.isWaste).toBe(true);
    expect(verdict.reason).toContain('48h');
  });

  it('does not flag a gateway with traffic', () => {
    expect(policy.evaluate(makeGateway(2048), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created gateway (grace period)', () => {
    expect(policy.evaluate(makeGateway(0, yesterday), now).isWaste).toBe(false);
  });
});

describe('EbsGp2UpgradePolicy', () => {
  const policy = new EbsGp2UpgradePolicy();

  function makeGp2Volume(
    overrides: { createTime?: Date; tags?: Record<string, string> } = {},
  ): Gp2Volume {
    return new Gp2Volume({
      volumeId: 'vol-gp2',
      region,
      accountId: '123456789012',
      sizeGb: 200,
      createTime: overrides.createTime ?? oldDate,
      detectedAt: now,
      tags: overrides.tags ?? {},
      monthlyCostUsd: 4, // (0.10 - 0.08) * 200
    });
  }

  it('flags an old gp2 volume as an upgrade opportunity', () => {
    expect(policy.evaluate(makeGp2Volume(), now).isWaste).toBe(true);
  });

  it('does not flag a freshly created gp2 volume (grace period)', () => {
    expect(policy.evaluate(makeGp2Volume({ createTime: yesterday }), now).isWaste).toBe(false);
  });

  it('does not flag a gp2 volume carrying the ignore tag', () => {
    const verdict = policy.evaluate(
      makeGp2Volume({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }),
      now,
    );
    expect(verdict.isWaste).toBe(false);
  });

  it('reports the saving in the wasteReason', () => {
    expect(makeGp2Volume().wasteReason).toContain('saves $4.00/mo');
  });
});

describe('EbsIdlePolicy', () => {
  const policy = new EbsIdlePolicy();

  function makeIdleVolume(
    overrides: { readOps?: number; writeOps?: number; createTime?: Date; tags?: Record<string, string> } = {},
  ): IdleEbsVolume {
    return new IdleEbsVolume({
      volumeId: 'vol-idle',
      region,
      accountId: '123456789012',
      sizeGb: 100,
      volumeType: 'gp3',
      attachedInstanceId: 'i-123',
      readOps: overrides.readOps ?? 0,
      writeOps: overrides.writeOps ?? 0,
      metricWindowHours: 48,
      createTime: overrides.createTime ?? oldDate,
      detectedAt: now,
      tags: overrides.tags ?? {},
      monthlyCostUsd: 8,
    });
  }

  it('flags an old attached volume with zero I/O', () => {
    const verdict = policy.evaluate(makeIdleVolume(), now);
    expect(verdict.isWaste).toBe(true);
    expect(verdict.reason).toContain('48h');
  });

  it('does not flag a volume with I/O activity', () => {
    expect(policy.evaluate(makeIdleVolume({ readOps: 10, writeOps: 5 }), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created volume (grace period)', () => {
    expect(policy.evaluate(makeIdleVolume({ createTime: yesterday }), now).isWaste).toBe(false);
  });

  it('honours a custom max-ops threshold', () => {
    const lenient = new EbsIdlePolicy({}, 100);
    expect(lenient.evaluate(makeIdleVolume({ readOps: 50, writeOps: 40 }), now).isWaste).toBe(true);
    expect(lenient.evaluate(makeIdleVolume({ readOps: 80, writeOps: 40 }), now).isWaste).toBe(false);
  });

  it('flags a volume whose total ops equal the max-ops threshold exactly (boundary)', () => {
    const lenient = new EbsIdlePolicy({}, 100);
    expect(lenient.evaluate(makeIdleVolume({ readOps: 60, writeOps: 40 }), now).isWaste).toBe(true);
  });

  it('does not flag a volume carrying the ignore tag', () => {
    expect(
      policy.evaluate(makeIdleVolume({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now).isWaste,
    ).toBe(false);
  });
});

describe('Ec2UnderutilizedPolicy', () => {
  const policy = new Ec2UnderutilizedPolicy();

  function makeInstance(
    overrides: Partial<UnderutilizedEc2InstanceProps> = {},
  ): UnderutilizedEc2Instance {
    return new UnderutilizedEc2Instance({
      instanceId: 'i-underused',
      region,
      accountId: '123456789012',
      instanceType: 'm5.large',
      avgCpuPercent: 1.2,
      maxCpuPercent: 2.5,
      windowDays: 14,
      launchTime: oldDate,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 16,
      ...overrides,
    });
  }

  it('flags an old instance with low max CPU', () => {
    const verdict = policy.evaluate(makeInstance(), now);
    expect(verdict.isWaste).toBe(true);
    expect(verdict.reason).toContain('14d');
  });

  it('does not flag an instance with CPU above threshold', () => {
    expect(policy.evaluate(makeInstance({ maxCpuPercent: 10 }), now).isWaste).toBe(false);
  });

  it('does not flag an instance whose max CPU equals the threshold exactly (boundary)', () => {
    expect(policy.evaluate(makeInstance({ maxCpuPercent: 5 }), now).isWaste).toBe(false);
  });

  it('does not flag a freshly launched instance (grace period)', () => {
    expect(policy.evaluate(makeInstance({ launchTime: yesterday }), now).isWaste).toBe(false);
  });

  it('honours a custom CPU threshold', () => {
    const lenient = new Ec2UnderutilizedPolicy({}, 15);
    expect(lenient.evaluate(makeInstance({ maxCpuPercent: 10 }), now).isWaste).toBe(true);
  });

  it('does not flag an instance carrying the ignore tag', () => {
    expect(
      policy.evaluate(makeInstance({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now).isWaste,
    ).toBe(false);
  });

  it('includes the rightsizing advisory in the wasteReason', () => {
    expect(makeInstance().wasteReason).toContain('verify RAM/network before rightsizing');
  });
});

describe('RdsUnderutilizedPolicy', () => {
  const policy = new RdsUnderutilizedPolicy();

  function makeInstance(
    overrides: Partial<RdsUnderutilizedInstanceProps> = {},
  ): RdsUnderutilizedInstance {
    return new RdsUnderutilizedInstance({
      dbInstanceIdentifier: 'db-underused',
      region,
      accountId: '123456789012',
      dbInstanceClass: 'db.t3.medium',
      engine: 'postgres',
      avgCpuPercent: 1.2,
      maxCpuPercent: 2.5,
      windowDays: 14,
      instanceCreateTime: oldDate,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 20,
      ...overrides,
    });
  }

  it('flags an old instance with low max CPU', () => {
    const verdict = policy.evaluate(makeInstance(), now);
    expect(verdict.isWaste).toBe(true);
    expect(verdict.reason).toContain('14d');
  });

  it('does not flag an instance with CPU above threshold', () => {
    expect(policy.evaluate(makeInstance({ maxCpuPercent: 10 }), now).isWaste).toBe(false);
  });

  it('does not flag an instance whose max CPU equals the threshold exactly (boundary)', () => {
    expect(policy.evaluate(makeInstance({ maxCpuPercent: 5 }), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created instance (grace period)', () => {
    expect(policy.evaluate(makeInstance({ instanceCreateTime: yesterday }), now).isWaste).toBe(false);
  });

  it('honours a custom CPU threshold', () => {
    const lenient = new RdsUnderutilizedPolicy({}, 15);
    expect(lenient.evaluate(makeInstance({ maxCpuPercent: 10 }), now).isWaste).toBe(true);
  });

  it('does not flag an instance carrying the ignore tag', () => {
    expect(
      policy.evaluate(makeInstance({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now).isWaste,
    ).toBe(false);
  });

  it('includes the rightsizing advisory in the wasteReason', () => {
    expect(makeInstance().wasteReason).toContain('verify storage I/O and connections before rightsizing');
  });
});

describe('LogGroupWastePolicy', () => {
  const policy = new LogGroupWastePolicy();

  function makeGroup(retentionInDays?: number, creationTime = oldDate): LogGroup {
    return new LogGroup({
      logGroupName: '/aws/lambda/my-fn',
      region,
      accountId: '123456789012',
      storedBytes: 1024 ** 3,
      retentionInDays,
      creationTime,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 0.03,
    });
  }

  it('flags an old log group with no retention policy', () => {
    expect(policy.evaluate(makeGroup(undefined), now).isWaste).toBe(true);
  });

  it('does not flag a log group with a retention policy', () => {
    expect(policy.evaluate(makeGroup(14), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created log group (grace period)', () => {
    expect(policy.evaluate(makeGroup(undefined, yesterday), now).isWaste).toBe(false);
  });
});

describe('OrphanedEniWastePolicy', () => {
  const policy = new OrphanedEniWastePolicy();

  function makeEni(status: string, tags: Record<string, string> = {}): OrphanedEni {
    return new OrphanedEni({
      networkInterfaceId: 'eni-1',
      region,
      accountId: '123456789012',
      vpcId: 'vpc-1',
      subnetId: 'subnet-1',
      status,
      detectedAt: now,
      tags,
    });
  }

  it('flags an available (unattached) ENI', () => {
    expect(policy.evaluate(makeEni('available'), now).isWaste).toBe(true);
  });

  it('does not flag an in-use ENI', () => {
    expect(policy.evaluate(makeEni('in-use'), now).isWaste).toBe(false);
  });

  it('does not flag an ENI carrying the ignore tag', () => {
    expect(
      policy.evaluate(makeEni('available', { [DEFAULT_IGNORE_TAG]: 'true' }), now).isWaste,
    ).toBe(false);
  });
});

describe('S3NoLifecyclePolicy', () => {
  const policy = new S3NoLifecyclePolicy();

  function makeBucket(hasLifecyclePolicy: boolean, creationDate = oldDate): S3Bucket {
    return new S3Bucket({
      bucketName: 'my-bucket',
      region,
      accountId: '123456789012',
      sizeBytes: 1024 ** 3,
      hasLifecyclePolicy,
      creationDate,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 0.0092,
    });
  }

  it('flags an old bucket with no lifecycle policy', () => {
    expect(policy.evaluate(makeBucket(false), now).isWaste).toBe(true);
  });

  it('does not flag a bucket with a lifecycle policy', () => {
    expect(policy.evaluate(makeBucket(true), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created bucket (grace period)', () => {
    expect(policy.evaluate(makeBucket(false, yesterday), now).isWaste).toBe(false);
  });
});

describe('LambdaUnderutilizedPolicy', () => {
  const policy = new LambdaUnderutilizedPolicy();

  function makeFn(invocationsLastWindow: number, lastModified = oldDate): UnderutilizedLambdaFunction {
    return new UnderutilizedLambdaFunction({
      functionName: 'my-fn',
      region,
      accountId: '123456789012',
      memorySizeMb: 128,
      invocationsLastWindow,
      windowDays: 7,
      lastModified,
      detectedAt: now,
      tags: {},
    });
  }

  it('flags an old function with zero invocations', () => {
    expect(policy.evaluate(makeFn(0), now).isWaste).toBe(true);
  });

  it('does not flag a function with invocations above threshold', () => {
    expect(policy.evaluate(makeFn(10), now).isWaste).toBe(false);
  });

  it('does not flag a freshly modified function (grace period)', () => {
    expect(policy.evaluate(makeFn(0, yesterday), now).isWaste).toBe(false);
  });

  it('honours a custom invocations threshold', () => {
    const lenient = new LambdaUnderutilizedPolicy({}, 5);
    expect(lenient.evaluate(makeFn(3), now).isWaste).toBe(true);
  });
});

describe('EfsUnusedPolicy', () => {
  const policy = new EfsUnusedPolicy();

  function makeFs(
    overrides: { numberOfMountTargets?: number; ioBytesLastWindow?: number; creationTime?: Date } = {},
  ): EfsFileSystem {
    return new EfsFileSystem({
      fileSystemId: 'fs-1',
      region,
      accountId: '123456789012',
      sizeBytes: 1024 ** 3,
      numberOfMountTargets: overrides.numberOfMountTargets ?? 0,
      ioBytesLastWindow: overrides.ioBytesLastWindow ?? 0,
      metricWindowHours: 48,
      creationTime: overrides.creationTime ?? oldDate,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 0.3,
    });
  }

  it('flags an old file system with no mount targets', () => {
    expect(policy.evaluate(makeFs({ numberOfMountTargets: 0 }), now).isWaste).toBe(true);
  });

  it('flags an old file system mounted but with zero I/O', () => {
    expect(policy.evaluate(makeFs({ numberOfMountTargets: 1, ioBytesLastWindow: 0 }), now).isWaste).toBe(
      true,
    );
  });

  it('does not flag a file system mounted with I/O activity', () => {
    expect(
      policy.evaluate(makeFs({ numberOfMountTargets: 1, ioBytesLastWindow: 2048 }), now).isWaste,
    ).toBe(false);
  });

  it('does not flag a freshly created file system (grace period)', () => {
    expect(policy.evaluate(makeFs({ numberOfMountTargets: 0, creationTime: yesterday }), now).isWaste).toBe(
      false,
    );
  });

  it('honours a custom I/O threshold', () => {
    const lenient = new EfsUnusedPolicy({}, 1024);
    expect(lenient.evaluate(makeFs({ numberOfMountTargets: 1, ioBytesLastWindow: 512 }), now).isWaste).toBe(
      true,
    );
  });
});

describe('DynamoDbOverprovisionedPolicy', () => {
  const policy = new DynamoDbOverprovisionedPolicy();
  const WINDOW_DAYS = 7;
  const WINDOW_SECONDS = WINDOW_DAYS * 24 * 60 * 60;

  function makeTable(
    overrides: {
      consumedReadCapacityUnits?: number;
      consumedWriteCapacityUnits?: number;
      creationDateTime?: Date;
    } = {},
  ): OverprovisionedDynamoDbTable {
    return new OverprovisionedDynamoDbTable({
      tableName: 'my-table',
      region,
      accountId: '123456789012',
      readCapacityUnits: 100,
      writeCapacityUnits: 100,
      consumedReadCapacityUnits: overrides.consumedReadCapacityUnits ?? 0,
      consumedWriteCapacityUnits: overrides.consumedWriteCapacityUnits ?? 0,
      windowDays: WINDOW_DAYS,
      creationDateTime: overrides.creationDateTime ?? oldDate,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 12.5,
    });
  }

  it('flags an old table with near-zero utilization', () => {
    expect(policy.evaluate(makeTable(), now).isWaste).toBe(true);
  });

  it('does not flag a table with read utilization above threshold', () => {
    const consumed = 50 * WINDOW_SECONDS; // 50% read utilization
    expect(policy.evaluate(makeTable({ consumedReadCapacityUnits: consumed }), now).isWaste).toBe(false);
  });

  it('does not flag a table with write utilization above threshold', () => {
    const consumed = 50 * WINDOW_SECONDS; // 50% write utilization
    expect(policy.evaluate(makeTable({ consumedWriteCapacityUnits: consumed }), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created table (grace period)', () => {
    expect(policy.evaluate(makeTable({ creationDateTime: yesterday }), now).isWaste).toBe(false);
  });

  it('honours a custom utilization threshold', () => {
    const lenient = new DynamoDbOverprovisionedPolicy({}, 60);
    const consumed = 50 * WINDOW_SECONDS; // 50% utilization, below the 60% custom threshold
    expect(lenient.evaluate(makeTable({ consumedReadCapacityUnits: consumed }), now).isWaste).toBe(true);
  });
});

describe('ElastiCacheIdlePolicy', () => {
  const policy = new ElastiCacheIdlePolicy();

  function makeCluster(connectionsLastWindow: number, createTime = oldDate): IdleElastiCacheCluster {
    return new IdleElastiCacheCluster({
      cacheClusterId: 'my-cluster',
      region,
      accountId: '123456789012',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 1,
      connectionsLastWindow,
      metricWindowHours: 48,
      createTime,
      detectedAt: now,
      tags: {},
      monthlyCostUsd: 12.41,
    });
  }

  it('flags an old cluster with zero connections', () => {
    expect(policy.evaluate(makeCluster(0), now).isWaste).toBe(true);
  });

  it('does not flag a cluster with active connections', () => {
    expect(policy.evaluate(makeCluster(5), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created cluster (grace period)', () => {
    expect(policy.evaluate(makeCluster(0, yesterday), now).isWaste).toBe(false);
  });
});

function makeAmi(overrides: { creationDate?: Date; inUse?: boolean } = {}): AmiUnused {
  return new AmiUnused({
    imageId: 'ami-1',
    region,
    accountId: '123456789012',
    name: 'my-ami',
    creationDate: overrides.creationDate ?? oldDate,
    detectedAt: now,
    inUse: overrides.inUse ?? false,
    totalSnapshotSizeGb: 20,
    tags: {},
    monthlyCostUsd: 1,
  });
}

describe('AmiUnusedPolicy', () => {
  const policy = new AmiUnusedPolicy();

  it('flags an old AMI not referenced by any instance or launch template', () => {
    expect(policy.evaluate(makeAmi(), now).isWaste).toBe(true);
  });

  it('does not flag an AMI referenced by an instance/launch template', () => {
    expect(policy.evaluate(makeAmi({ inUse: true }), now).isWaste).toBe(false);
  });

  it('does not flag a freshly created AMI (grace period)', () => {
    expect(policy.evaluate(makeAmi({ creationDate: yesterday }), now).isWaste).toBe(false);
  });
});

function makeEcrImage(overrides: { imagePushedAt?: Date } = {}): EcrImageUntagged {
  return new EcrImageUntagged({
    imageDigest: 'sha256:abc',
    region,
    accountId: '123456789012',
    repositoryName: 'my-repo',
    sizeBytes: 1024 ** 3,
    imagePushedAt: overrides.imagePushedAt ?? oldDate,
    detectedAt: now,
    tags: {},
    monthlyCostUsd: 0.1,
  });
}

describe('EcrImageUntaggedPolicy', () => {
  const policy = new EcrImageUntaggedPolicy();

  it('flags an old untagged image', () => {
    expect(policy.evaluate(makeEcrImage(), now).isWaste).toBe(true);
  });

  it('does not flag a freshly pushed image (grace period)', () => {
    expect(policy.evaluate(makeEcrImage({ imagePushedAt: yesterday }), now).isWaste).toBe(false);
  });
});

function makeUpload(overrides: { initiated?: Date } = {}): S3MultipartUploadAbandoned {
  return new S3MultipartUploadAbandoned({
    uploadId: 'upload-1',
    region,
    accountId: '123456789012',
    bucketName: 'my-bucket',
    key: 'file.zip',
    uploadedBytes: 1024 ** 3,
    initiated: overrides.initiated ?? oldDate,
    detectedAt: now,
    tags: {},
    monthlyCostUsd: 0.02,
  });
}

describe('S3MultipartUploadAbandonedPolicy', () => {
  const policy = new S3MultipartUploadAbandonedPolicy();

  it('flags an old abandoned upload', () => {
    expect(policy.evaluate(makeUpload(), now).isWaste).toBe(true);
  });

  it('does not flag a freshly initiated upload (grace period)', () => {
    expect(policy.evaluate(makeUpload({ initiated: yesterday }), now).isWaste).toBe(false);
  });
});

function makeRdsSnapshot(overrides: { snapshotCreateTime?: Date } = {}): RdsManualSnapshotOld {
  return new RdsManualSnapshotOld({
    snapshotId: 'snap-1',
    region,
    accountId: '123456789012',
    sourceDbInstanceId: 'my-db',
    engine: 'postgres',
    allocatedStorageGb: 100,
    snapshotCreateTime: overrides.snapshotCreateTime ?? oldDate,
    detectedAt: now,
    tags: {},
    monthlyCostUsd: 9.5,
  });
}

describe('RdsManualSnapshotOldPolicy', () => {
  const policy = new RdsManualSnapshotOldPolicy();

  it('flags an old manual snapshot', () => {
    expect(policy.evaluate(makeRdsSnapshot(), now).isWaste).toBe(true);
  });

  it('does not flag a freshly created snapshot (grace period)', () => {
    expect(policy.evaluate(makeRdsSnapshot({ snapshotCreateTime: yesterday }), now).isWaste).toBe(false);
  });
});

function makeSecret(overrides: { createdDate?: Date; lastAccessedDate?: Date } = {}): SecretsManagerUnused {
  return new SecretsManagerUnused({
    arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc',
    region,
    accountId: '123456789012',
    name: 'my-secret',
    createdDate: overrides.createdDate ?? oldDate,
    lastAccessedDate: overrides.lastAccessedDate,
    detectedAt: now,
    tags: {},
    monthlyCostUsd: 0.4,
  });
}

describe('SecretsManagerUnusedPolicy', () => {
  const policy = new SecretsManagerUnusedPolicy();

  it('flags a secret never accessed and older than the unused threshold', () => {
    expect(policy.evaluate(makeSecret(), now).isWaste).toBe(true);
  });

  it('does not flag a recently created, never-accessed secret', () => {
    expect(policy.evaluate(makeSecret({ createdDate: yesterday }), now).isWaste).toBe(false);
  });

  it('flags a secret not accessed within the unused threshold', () => {
    expect(policy.evaluate(makeSecret({ lastAccessedDate: oldDate }), now).isWaste).toBe(true);
  });

  it('does not flag a secret accessed recently', () => {
    expect(policy.evaluate(makeSecret({ lastAccessedDate: yesterday }), now).isWaste).toBe(false);
  });
});
