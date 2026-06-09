// Entities
export { EbsVolume } from './entities/ebs-volume.entity';
export type { EbsVolumeProps, EbsVolumeState } from './entities/ebs-volume.entity';
export { ElasticIp } from './entities/elastic-ip.entity';
export type { ElasticIpProps } from './entities/elastic-ip.entity';
export { RdsInstance } from './entities/rds-instance.entity';
export type { RdsInstanceProps, RdsInstanceStatus } from './entities/rds-instance.entity';
export { LoadBalancer } from './entities/load-balancer.entity';
export type { LoadBalancerProps, LoadBalancerType } from './entities/load-balancer.entity';
export { Ec2Instance } from './entities/ec2-instance.entity';
export type { Ec2InstanceProps, Ec2InstanceState, AttachedVolume } from './entities/ec2-instance.entity';
export { EbsSnapshot } from './entities/ebs-snapshot.entity';
export type { EbsSnapshotProps } from './entities/ebs-snapshot.entity';
export { NatGateway } from './entities/nat-gateway.entity';
export type { NatGatewayProps } from './entities/nat-gateway.entity';

// Value Objects
export { AwsRegion } from './value-objects/aws-region.value-object';
export { CostEstimate } from './value-objects/cost-estimate.value-object';

// Outbound Ports
export type { PricingPort } from './ports/outbound/pricing.port';
export type { EbsVolumeRepositoryPort } from './ports/outbound/ebs-volume-repository.port';
export { EBS_VOLUME_REPOSITORY_PORT } from './ports/outbound/ebs-volume-repository.port';
export type { ElasticIpRepositoryPort } from './ports/outbound/elastic-ip-repository.port';
export { ELASTIC_IP_REPOSITORY_PORT } from './ports/outbound/elastic-ip-repository.port';
export type { RdsInstanceRepositoryPort } from './ports/outbound/rds-instance-repository.port';
export { RDS_INSTANCE_REPOSITORY_PORT } from './ports/outbound/rds-instance-repository.port';
export type { LoadBalancerRepositoryPort } from './ports/outbound/load-balancer-repository.port';
export { LOAD_BALANCER_REPOSITORY_PORT } from './ports/outbound/load-balancer-repository.port';
export type { Ec2InstanceRepositoryPort } from './ports/outbound/ec2-instance-repository.port';
export { EC2_INSTANCE_REPOSITORY_PORT } from './ports/outbound/ec2-instance-repository.port';
export type { EbsSnapshotRepositoryPort } from './ports/outbound/ebs-snapshot-repository.port';
export { EBS_SNAPSHOT_REPOSITORY_PORT } from './ports/outbound/ebs-snapshot-repository.port';
export type { NatGatewayRepositoryPort } from './ports/outbound/nat-gateway-repository.port';
export { NAT_GATEWAY_REPOSITORY_PORT } from './ports/outbound/nat-gateway-repository.port';

// Inbound Ports
export type {
  FindWastedResourcesRequest,
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  ResourceScanError,
} from './ports/inbound/find-wasted-resources.use-case.port';
