import {
  EbsVolumeWastePolicy,
  ElasticIpWastePolicy,
  RdsInstanceWastePolicy,
  LoadBalancerWastePolicy,
  Ec2InstanceWastePolicy,
  EbsSnapshotWastePolicy,
  NatGatewayWastePolicy,
} from './resource-waste-policies';
import { DEFAULT_IGNORE_TAG } from './waste-policy';
import { EbsVolume } from '../entities/ebs-volume.entity';
import { ElasticIp } from '../entities/elastic-ip.entity';
import { RdsInstance } from '../entities/rds-instance.entity';
import { LoadBalancer } from '../entities/load-balancer.entity';
import { Ec2Instance } from '../entities/ec2-instance.entity';
import { EbsSnapshot } from '../entities/ebs-snapshot.entity';
import { NatGateway } from '../entities/nat-gateway.entity';
import type { EbsSnapshotProps } from '../entities/ebs-snapshot.entity';
import type { Ec2InstanceProps } from '../entities/ec2-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');
const now = new Date('2026-06-12T00:00:00Z');
const oldDate = new Date('2025-01-01');
const yesterday = new Date('2026-06-11T00:00:00Z');

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
