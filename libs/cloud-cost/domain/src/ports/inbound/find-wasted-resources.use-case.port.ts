import type { Result } from 'shared-kernel';
import type { EbsVolume } from '../../entities/ebs-volume.entity';
import type { ElasticIp } from '../../entities/elastic-ip.entity';
import type { RdsInstance } from '../../entities/rds-instance.entity';
import type { LoadBalancer } from '../../entities/load-balancer.entity';
import type { Ec2Instance } from '../../entities/ec2-instance.entity';
import type { EbsSnapshot } from '../../entities/ebs-snapshot.entity';
import type { NatGateway } from '../../entities/nat-gateway.entity';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface FindWastedResourcesRequest {
  regions: AwsRegion[];
}

export interface ResourceScanError {
  resourceType: string;
  error: Error;
}

export interface WastedResourcesSummary {
  ebsVolumes: EbsVolume[];
  elasticIps: ElasticIp[];
  rdsInstances: RdsInstance[];
  loadBalancers: LoadBalancer[];
  stoppedEc2Instances: Ec2Instance[];
  orphanSnapshots: EbsSnapshot[];
  idleNatGateways: NatGateway[];
  totalMonthlyCostUsd: number;
  scanErrors: ResourceScanError[];
}

export interface FindWastedResourcesUseCasePort {
  execute(
    request: FindWastedResourcesRequest,
  ): Promise<Result<WastedResourcesSummary>>;
}
