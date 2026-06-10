import { Result } from 'shared-kernel';
import type {
  FindWastedResourcesRequest,
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  ResourceScanError,
  EbsVolumeRepositoryPort,
  ElasticIpRepositoryPort,
  RdsInstanceRepositoryPort,
  LoadBalancerRepositoryPort,
  Ec2InstanceRepositoryPort,
  EbsSnapshotRepositoryPort,
  NatGatewayRepositoryPort,
} from 'cloud-cost-domain';
import { FindUnattachedEbsVolumesUseCase } from './find-unattached-ebs-volumes.use-case';
import { FindUnassociatedElasticIpsUseCase } from './find-unassociated-elastic-ips.use-case';
import { FindStoppedRdsInstancesUseCase } from './find-stopped-rds-instances.use-case';
import { FindIdleLoadBalancersUseCase } from './find-idle-load-balancers.use-case';
import { FindStoppedEc2InstancesUseCase } from './find-stopped-ec2-instances.use-case';
import { FindOrphanEbsSnapshotsUseCase } from './find-orphan-ebs-snapshots.use-case';
import { FindIdleNatGatewaysUseCase } from './find-idle-nat-gateways.use-case';

export interface AnalyzeCloudWasteDependencies {
  ebsRepository: EbsVolumeRepositoryPort;
  elasticIpRepository: ElasticIpRepositoryPort;
  rdsRepository: RdsInstanceRepositoryPort;
  loadBalancerRepository: LoadBalancerRepositoryPort;
  ec2Repository: Ec2InstanceRepositoryPort;
  snapshotRepository: EbsSnapshotRepositoryPort;
  natGatewayRepository: NatGatewayRepositoryPort;
}

function collect<T>(
  result: Result<T[]>,
  resourceType: string,
  errors: ResourceScanError[],
): T[] {
  if (result.ok) return result.value;
  errors.push({ resourceType, error: result.error });
  return [];
}

export class AnalyzeCloudWasteUseCase implements FindWastedResourcesUseCasePort {
  private readonly findEbs: FindUnattachedEbsVolumesUseCase;
  private readonly findEips: FindUnassociatedElasticIpsUseCase;
  private readonly findRds: FindStoppedRdsInstancesUseCase;
  private readonly findElb: FindIdleLoadBalancersUseCase;
  private readonly findEc2: FindStoppedEc2InstancesUseCase;
  private readonly findSnapshots: FindOrphanEbsSnapshotsUseCase;
  private readonly findNatGateways: FindIdleNatGatewaysUseCase;

  constructor(deps: AnalyzeCloudWasteDependencies) {
    this.findEbs = new FindUnattachedEbsVolumesUseCase(deps.ebsRepository);
    this.findEips = new FindUnassociatedElasticIpsUseCase(deps.elasticIpRepository);
    this.findRds = new FindStoppedRdsInstancesUseCase(deps.rdsRepository);
    this.findElb = new FindIdleLoadBalancersUseCase(deps.loadBalancerRepository);
    this.findEc2 = new FindStoppedEc2InstancesUseCase(deps.ec2Repository);
    this.findSnapshots = new FindOrphanEbsSnapshotsUseCase(deps.snapshotRepository);
    this.findNatGateways = new FindIdleNatGatewaysUseCase(deps.natGatewayRepository);
  }

  async execute(
    request: FindWastedResourcesRequest,
  ): Promise<Result<WastedResourcesSummary>> {
    const [ebsResult, eipResult, rdsResult, elbResult, ec2Result, snapshotResult, natResult] =
      await Promise.all([
        this.findEbs.execute(request.regions),
        this.findEips.execute(request.regions),
        this.findRds.execute(request.regions),
        this.findElb.execute(request.regions),
        this.findEc2.execute(request.regions),
        this.findSnapshots.execute(request.regions),
        this.findNatGateways.execute(request.regions),
      ]);

    const scanErrors: ResourceScanError[] = [];
    const ebsVolumes = collect(ebsResult, 'EBS Volumes', scanErrors);
    const elasticIps = collect(eipResult, 'Elastic IPs', scanErrors);
    const rdsInstances = collect(rdsResult, 'RDS Instances', scanErrors);
    const loadBalancers = collect(elbResult, 'Load Balancers', scanErrors);
    const stoppedEc2Instances = collect(ec2Result, 'EC2 Instances', scanErrors);
    const orphanSnapshots = collect(snapshotResult, 'EBS Snapshots', scanErrors);
    const idleNatGateways = collect(natResult, 'NAT Gateways', scanErrors);

    const totalMonthlyCostUsd =
      ebsVolumes.reduce((sum, v) => sum + v.costEstimate.monthlyCostUsd, 0) +
      elasticIps.reduce((sum, ip) => sum + ip.costEstimate.monthlyCostUsd, 0) +
      rdsInstances.reduce((sum, db) => sum + db.costEstimate.monthlyCostUsd, 0) +
      loadBalancers.reduce((sum, lb) => sum + lb.costEstimate.monthlyCostUsd, 0) +
      stoppedEc2Instances.reduce((sum, inst) => sum + inst.costEstimate.monthlyCostUsd, 0) +
      orphanSnapshots.reduce((sum, snap) => sum + snap.costEstimate.monthlyCostUsd, 0) +
      idleNatGateways.reduce((sum, gw) => sum + gw.costEstimate.monthlyCostUsd, 0);

    return Result.ok({
      ebsVolumes,
      elasticIps,
      rdsInstances,
      loadBalancers,
      stoppedEc2Instances,
      orphanSnapshots,
      idleNatGateways,
      totalMonthlyCostUsd,
      scanErrors,
    });
  }
}
