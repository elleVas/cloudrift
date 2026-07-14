// SPDX-License-Identifier: Apache-2.0
// Wasted resource model
export {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_META,
  categoryOf,
  isEstimated,
} from './wasted-resource';
export type {
  ResourceKind,
  WastedResource,
  FindingCategory,
  ResourceKindMeta,
} from './wasted-resource';
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
export { IdleEbsVolume } from './entities/idle-ebs-volume.entity';
export type { IdleEbsVolumeProps } from './entities/idle-ebs-volume.entity';
export { UnderutilizedEc2Instance } from './entities/underutilized-ec2-instance.entity';
export type { UnderutilizedEc2InstanceProps } from './entities/underutilized-ec2-instance.entity';
export { RdsUnderutilizedInstance } from './entities/rds-underutilized-instance.entity';
export type { RdsUnderutilizedInstanceProps } from './entities/rds-underutilized-instance.entity';
export { LogGroup } from './entities/log-group.entity';
export type { LogGroupProps } from './entities/log-group.entity';
export { OrphanedEni } from './entities/orphaned-eni.entity';
export type { OrphanedEniProps } from './entities/orphaned-eni.entity';
export { S3Bucket } from './entities/s3-bucket.entity';
export type { S3BucketProps } from './entities/s3-bucket.entity';
export { UnderutilizedLambdaFunction } from './entities/underutilized-lambda-function.entity';
export type { UnderutilizedLambdaFunctionProps } from './entities/underutilized-lambda-function.entity';
export { EfsFileSystem } from './entities/efs-file-system.entity';
export type { EfsFileSystemProps } from './entities/efs-file-system.entity';
export { OverprovisionedDynamoDbTable } from './entities/overprovisioned-dynamodb-table.entity';
export type { OverprovisionedDynamoDbTableProps } from './entities/overprovisioned-dynamodb-table.entity';
export { IdleElastiCacheCluster } from './entities/idle-elasticache-cluster.entity';
export type { IdleElastiCacheClusterProps } from './entities/idle-elasticache-cluster.entity';
export { RedshiftCluster } from './entities/redshift-cluster.entity';
export type { RedshiftClusterProps } from './entities/redshift-cluster.entity';
export { OpenSearchDomain } from './entities/opensearch-domain.entity';
export type { OpenSearchDomainProps } from './entities/opensearch-domain.entity';
export { MskCluster } from './entities/msk-cluster.entity';
export type { MskClusterProps } from './entities/msk-cluster.entity';
export { FsxFileSystem } from './entities/fsx-file-system.entity';
export type { FsxFileSystemProps } from './entities/fsx-file-system.entity';
export { DocumentDbInstance } from './entities/documentdb-instance.entity';
export type { DocumentDbInstanceProps } from './entities/documentdb-instance.entity';
export { NeptuneInstance } from './entities/neptune-instance.entity';
export type { NeptuneInstanceProps } from './entities/neptune-instance.entity';
export { MqBroker } from './entities/mq-broker.entity';
export type { MqBrokerProps } from './entities/mq-broker.entity';
export { Workspace } from './entities/workspace.entity';
export type { WorkspaceProps } from './entities/workspace.entity';
export { VpnConnection } from './entities/vpn-connection.entity';
export type { VpnConnectionProps } from './entities/vpn-connection.entity';
export { TransitGatewayAttachment } from './entities/transit-gateway-attachment.entity';
export type { TransitGatewayAttachmentProps } from './entities/transit-gateway-attachment.entity';
export { KinesisStream } from './entities/kinesis-stream.entity';
export type { KinesisStreamProps } from './entities/kinesis-stream.entity';
export { SqsDlqAbandoned } from './entities/sqs-dlq-abandoned.entity';
export type { SqsDlqAbandonedProps } from './entities/sqs-dlq-abandoned.entity';
export { LambdaLogGroupOrphaned } from './entities/lambda-loggroup-orphaned.entity';
export type { LambdaLogGroupOrphanedProps } from './entities/lambda-loggroup-orphaned.entity';
export { AuroraServerlessOverprovisioned } from './entities/aurora-serverless-overprovisioned.entity';
export type { AuroraServerlessOverprovisionedProps } from './entities/aurora-serverless-overprovisioned.entity';

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
  EbsIdlePolicy,
  Ec2UnderutilizedPolicy,
  RdsUnderutilizedPolicy,
  LogGroupWastePolicy,
  OrphanedEniWastePolicy,
  S3NoLifecyclePolicy,
  LambdaUnderutilizedPolicy,
  EfsUnusedPolicy,
  DynamoDbOverprovisionedPolicy,
  ElastiCacheIdlePolicy,
  RedshiftIdleClusterPolicy,
  OpenSearchIdleDomainPolicy,
  MskIdleClusterPolicy,
  FsxIdleFilesystemPolicy,
  DocumentDbIdleInstancePolicy,
  NeptuneIdleInstancePolicy,
  MqIdleBrokerPolicy,
  WorkspacesIdlePolicy,
  VpnConnectionIdlePolicy,
  TransitGatewayIdleAttachmentPolicy,
  KinesisProvisionedIdleStreamPolicy,
  SqsDlqAbandonedWastePolicy,
  LambdaLogGroupOrphanedPolicy,
  AuroraServerlessOverprovisionedPolicy,
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
