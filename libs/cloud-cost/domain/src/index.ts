// Wasted resource model
export { RESOURCE_KINDS, RESOURCE_KIND_LABELS } from './wasted-resource';
export type { ResourceKind, WastedResource } from './wasted-resource';
export { groupByKind } from './group-by-kind';
export type { ResourceKindMap, FindingsByKind } from './group-by-kind';

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
export { Gp2Volume } from './entities/gp2-volume.entity';
export type { Gp2VolumeProps } from './entities/gp2-volume.entity';

// Value Objects
export { AwsRegion, InvalidAwsRegionError } from './value-objects/aws-region.value-object';
export { CostEstimate } from './value-objects/cost-estimate.value-object';

// Waste Policies
export {
  WastePolicy,
  waste,
  notWaste,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_IGNORE_TAG,
} from './policies/waste-policy';
export type { WasteVerdict, WastePolicyOptions } from './policies/waste-policy';
export {
  EbsVolumeWastePolicy,
  ElasticIpWastePolicy,
  RdsInstanceWastePolicy,
  LoadBalancerWastePolicy,
  Ec2InstanceWastePolicy,
  EbsSnapshotWastePolicy,
  NatGatewayWastePolicy,
  Gp2UpgradePolicy,
} from './policies/resource-waste-policies';

// Outbound Ports
export type { PricingPort } from './ports/outbound/pricing.port';
export type { WasteScannerPort } from './ports/outbound/waste-scanner.port';

// Inbound Ports
export type {
  FindWastedResourcesRequest,
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  ResourceScanError,
} from './ports/inbound/find-wasted-resources.use-case.port';
