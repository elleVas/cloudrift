import { AnalyzeCloudWasteUseCase } from './analyze-cloud-waste.use-case';
import {
  AwsRegion,
  EbsVolume,
  ElasticIp,
  EbsVolumeRepositoryPort,
  ElasticIpRepositoryPort,
  RdsInstanceRepositoryPort,
  LoadBalancerRepositoryPort,
  Ec2InstanceRepositoryPort,
  EbsSnapshotRepositoryPort,
  NatGatewayRepositoryPort,
} from 'cloud-cost-domain';
import { Result } from 'shared-kernel';

const region = AwsRegion.create('us-east-1');

function makeEbsVolume(id: string): EbsVolume {
  return new EbsVolume({
    volumeId: id,
    region,
    accountId: '123456789012',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'available',
    createTime: new Date('2025-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 8,
  });
}

function makeElasticIp(allocationId: string): ElasticIp {
  return new ElasticIp({
    allocationId,
    publicIp: '1.2.3.4',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 3.6,
  });
}

function makeEbsRepo(volumes: EbsVolume[], fail?: Error): EbsVolumeRepositoryPort {
  return {
    findUnattachedVolumes: async () =>
      fail ? Result.fail(fail) : Result.ok(volumes),
  };
}

function makeEipRepo(ips: ElasticIp[], fail?: Error): ElasticIpRepositoryPort {
  return {
    findUnassociatedElasticIps: async () =>
      fail ? Result.fail(fail) : Result.ok(ips),
  };
}

function makeRdsRepo(fail?: Error): RdsInstanceRepositoryPort {
  return { findStoppedInstances: async () => fail ? Result.fail(fail) : Result.ok([]) };
}

function makeElbRepo(fail?: Error): LoadBalancerRepositoryPort {
  return { findIdleLoadBalancers: async () => fail ? Result.fail(fail) : Result.ok([]) };
}

function makeEc2Repo(fail?: Error): Ec2InstanceRepositoryPort {
  return { findStoppedInstances: async () => fail ? Result.fail(fail) : Result.ok([]) };
}

function makeSnapshotRepo(fail?: Error): EbsSnapshotRepositoryPort {
  return { findOrphanSnapshots: async () => fail ? Result.fail(fail) : Result.ok([]) };
}

function makeNatRepo(fail?: Error): NatGatewayRepositoryPort {
  return { findIdleGateways: async () => fail ? Result.fail(fail) : Result.ok([]) };
}

function makeUseCase(
  ebsRepo: EbsVolumeRepositoryPort,
  eipRepo: ElasticIpRepositoryPort,
  rdsRepo: RdsInstanceRepositoryPort = makeRdsRepo(),
  elbRepo: LoadBalancerRepositoryPort = makeElbRepo(),
  ec2Repo: Ec2InstanceRepositoryPort = makeEc2Repo(),
  snapshotRepo: EbsSnapshotRepositoryPort = makeSnapshotRepo(),
  natRepo: NatGatewayRepositoryPort = makeNatRepo(),
) {
  return new AnalyzeCloudWasteUseCase({
    ebsRepository: ebsRepo,
    elasticIpRepository: eipRepo,
    rdsRepository: rdsRepo,
    loadBalancerRepository: elbRepo,
    ec2Repository: ec2Repo,
    snapshotRepository: snapshotRepo,
    natGatewayRepository: natRepo,
  });
}

describe('AnalyzeCloudWasteUseCase', () => {
  it('returns empty summary with no scan errors when all repositories succeed', async () => {
    const useCase = makeUseCase(makeEbsRepo([]), makeEipRepo([]));
    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ebsVolumes).toHaveLength(0);
    expect(result.value.elasticIps).toHaveLength(0);
    expect(result.value.rdsInstances).toHaveLength(0);
    expect(result.value.loadBalancers).toHaveLength(0);
    expect(result.value.stoppedEc2Instances).toHaveLength(0);
    expect(result.value.orphanSnapshots).toHaveLength(0);
    expect(result.value.idleNatGateways).toHaveLength(0);
    expect(result.value.totalMonthlyCostUsd).toBe(0);
    expect(result.value.scanErrors).toHaveLength(0);
  });

  it('aggregates volumes and IPs and computes total cost', async () => {
    const volumes = [makeEbsVolume('vol-1'), makeEbsVolume('vol-2')];
    const ips = [makeElasticIp('eipalloc-1')];

    const useCase = makeUseCase(makeEbsRepo(volumes), makeEipRepo(ips));
    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ebsVolumes).toHaveLength(2);
    expect(result.value.elasticIps).toHaveLength(1);
    // 2 × (100 GB × $0.08) + 1 × $3.60 = $16.00 + $3.60 = $19.60
    expect(result.value.totalMonthlyCostUsd).toBeCloseTo(19.6, 2);
    expect(result.value.scanErrors).toHaveLength(0);
  });

  it('returns partial results and records scanError when EBS repository fails', async () => {
    const err = new Error('EBS failed');
    const ips = [makeElasticIp('eipalloc-1')];
    const useCase = makeUseCase(makeEbsRepo([], err), makeEipRepo(ips));

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ebsVolumes).toHaveLength(0);
    expect(result.value.elasticIps).toHaveLength(1);
    expect(result.value.scanErrors).toHaveLength(1);
    expect(result.value.scanErrors[0].resourceType).toBe('EBS Volumes');
    expect(result.value.scanErrors[0].error).toBe(err);
  });

  it('returns partial results and records scanError when EIP repository fails', async () => {
    const err = new Error('EIP failed');
    const volumes = [makeEbsVolume('vol-1')];
    const useCase = makeUseCase(makeEbsRepo(volumes), makeEipRepo([], err));

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ebsVolumes).toHaveLength(1);
    expect(result.value.elasticIps).toHaveLength(0);
    expect(result.value.scanErrors).toHaveLength(1);
    expect(result.value.scanErrors[0].resourceType).toBe('Elastic IPs');
    expect(result.value.scanErrors[0].error).toBe(err);
  });

  it('returns partial results and records scanError when RDS repository fails', async () => {
    const err = new Error('RDS failed');
    const useCase = makeUseCase(makeEbsRepo([]), makeEipRepo([]), makeRdsRepo(err));

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanErrors).toHaveLength(1);
    expect(result.value.scanErrors[0].resourceType).toBe('RDS Instances');
  });

  it('returns partial results and records scanError when ELB repository fails', async () => {
    const err = new Error('ELB failed');
    const useCase = makeUseCase(makeEbsRepo([]), makeEipRepo([]), makeRdsRepo(), makeElbRepo(err));

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanErrors).toHaveLength(1);
    expect(result.value.scanErrors[0].resourceType).toBe('Load Balancers');
  });

  it('records scanError for NAT Gateways while preserving other results', async () => {
    const err = new Error('CloudWatch throttled');
    const volumes = [makeEbsVolume('vol-1')];
    const useCase = makeUseCase(
      makeEbsRepo(volumes), makeEipRepo([]), makeRdsRepo(), makeElbRepo(),
      makeEc2Repo(), makeSnapshotRepo(), makeNatRepo(err),
    );

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ebsVolumes).toHaveLength(1);
    expect(result.value.idleNatGateways).toHaveLength(0);
    expect(result.value.scanErrors).toHaveLength(1);
    expect(result.value.scanErrors[0].resourceType).toBe('NAT Gateways');
    expect(result.value.scanErrors[0].error).toBe(err);
  });

  it('accumulates multiple scanErrors when several repositories fail', async () => {
    const useCase = makeUseCase(
      makeEbsRepo([], new Error('EBS')),
      makeEipRepo([], new Error('EIP')),
      makeRdsRepo(new Error('RDS')),
    );

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanErrors).toHaveLength(3);
    expect(result.value.totalMonthlyCostUsd).toBe(0);
  });

  it('excludes failed resource costs from totalMonthlyCostUsd', async () => {
    const volumes = [makeEbsVolume('vol-1')];
    const useCase = makeUseCase(
      makeEbsRepo(volumes),
      makeEipRepo([], new Error('EIP throttled')),
    );

    const result = await useCase.execute({ regions: [region] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only EBS cost counted; EIP scan failed so nothing added
    expect(result.value.totalMonthlyCostUsd).toBeCloseTo(8.0, 2); // 100 GB × $0.08
    expect(result.value.scanErrors).toHaveLength(1);
  });
});
