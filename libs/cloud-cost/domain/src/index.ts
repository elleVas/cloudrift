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
export { SageMakerNotebookIdle } from './entities/sagemaker-notebook-idle.entity';
export type { SageMakerNotebookIdleProps } from './entities/sagemaker-notebook-idle.entity';
export { SageMakerEndpointIdle } from './entities/sagemaker-endpoint-idle.entity';
export type { SageMakerEndpointIdleProps } from './entities/sagemaker-endpoint-idle.entity';
export { SageMakerTrainingOrphaned } from './entities/sagemaker-training-orphaned.entity';
export type { SageMakerTrainingOrphanedProps } from './entities/sagemaker-training-orphaned.entity';
export { EnvironmentGhost } from './entities/environment-ghost.entity';
export type { EnvironmentGhostProps, EnvironmentGhostDetectionMethod } from './entities/environment-ghost.entity';
export { EksNodeOverprovisioned } from './entities/eks-node-overprovisioned.entity';
export type { EksNodeOverprovisionedProps } from './entities/eks-node-overprovisioned.entity';
export { EksOrphanPvc } from './entities/eks-orphan-pvc.entity';
export type { EksOrphanPvcProps } from './entities/eks-orphan-pvc.entity';
export { AmiUnused } from './entities/ami-unused.entity';
export type { AmiUnusedProps } from './entities/ami-unused.entity';
export { EcrImageUntagged } from './entities/ecr-image-untagged.entity';
export type { EcrImageUntaggedProps } from './entities/ecr-image-untagged.entity';
export { S3MultipartUploadAbandoned } from './entities/s3-multipart-upload-abandoned.entity';
export type { S3MultipartUploadAbandonedProps } from './entities/s3-multipart-upload-abandoned.entity';
export { RdsManualSnapshotOld } from './entities/rds-manual-snapshot-old.entity';
export type { RdsManualSnapshotOldProps } from './entities/rds-manual-snapshot-old.entity';
export { SecretsManagerUnused } from './entities/secretsmanager-unused.entity';
export type { SecretsManagerUnusedProps } from './entities/secretsmanager-unused.entity';
export { CodepipelinePipelineStale } from './entities/codepipeline-pipeline-stale.entity';
export type { CodepipelinePipelineStaleProps } from './entities/codepipeline-pipeline-stale.entity';

// Value Objects
export { AwsRegion, InvalidAwsRegionError, AWS_REGION_CODES } from './value-objects/aws-region.value-object';
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
export { EbsVolumeWastePolicy } from './policies/ebs-volume.policy';
export { ElasticIpWastePolicy } from './policies/elastic-ip.policy';
export { RdsInstanceWastePolicy } from './policies/rds-instance.policy';
export { LoadBalancerWastePolicy } from './policies/load-balancer.policy';
export { Ec2InstanceWastePolicy } from './policies/ec2-instance.policy';
export { EbsSnapshotWastePolicy } from './policies/ebs-snapshot.policy';
export { NatGatewayWastePolicy } from './policies/nat-gateway.policy';
export { EbsGp2UpgradePolicy } from './policies/gp2-volume.policy';
export { EbsIdlePolicy } from './policies/idle-ebs-volume.policy';
export { Ec2UnderutilizedPolicy } from './policies/underutilized-ec2-instance.policy';
export { RdsUnderutilizedPolicy } from './policies/rds-underutilized-instance.policy';
export { LogGroupWastePolicy } from './policies/log-group.policy';
export { OrphanedEniWastePolicy } from './policies/orphaned-eni.policy';
export { S3NoLifecyclePolicy } from './policies/s3-bucket.policy';
export { LambdaUnderutilizedPolicy } from './policies/underutilized-lambda-function.policy';
export { EfsUnusedPolicy } from './policies/efs-file-system.policy';
export { DynamoDbOverprovisionedPolicy } from './policies/overprovisioned-dynamodb-table.policy';
export { ElastiCacheIdlePolicy } from './policies/idle-elasticache-cluster.policy';
export { RedshiftIdleClusterPolicy } from './policies/redshift-cluster.policy';
export { OpenSearchIdleDomainPolicy } from './policies/opensearch-domain.policy';
export { MskIdleClusterPolicy } from './policies/msk-cluster.policy';
export { FsxIdleFilesystemPolicy } from './policies/fsx-file-system.policy';
export { DocumentDbIdleInstancePolicy } from './policies/documentdb-instance.policy';
export { NeptuneIdleInstancePolicy } from './policies/neptune-instance.policy';
export { MqIdleBrokerPolicy } from './policies/mq-broker.policy';
export { WorkspacesIdlePolicy } from './policies/workspace.policy';
export { VpnConnectionIdlePolicy } from './policies/vpn-connection.policy';
export { TransitGatewayIdleAttachmentPolicy } from './policies/transit-gateway-attachment.policy';
export { KinesisProvisionedIdleStreamPolicy } from './policies/kinesis-stream.policy';
export { SqsDlqAbandonedWastePolicy } from './policies/sqs-dlq-abandoned.policy';
export { LambdaLogGroupOrphanedPolicy } from './policies/lambda-loggroup-orphaned.policy';
export { AuroraServerlessOverprovisionedPolicy } from './policies/aurora-serverless-overprovisioned.policy';
export { SageMakerNotebookIdlePolicy } from './policies/sagemaker-notebook-idle.policy';
export { SageMakerEndpointIdlePolicy } from './policies/sagemaker-endpoint-idle.policy';
export { SageMakerTrainingOrphanedPolicy } from './policies/sagemaker-training-orphaned.policy';
export { EnvironmentGhostPolicy } from './policies/environment-ghost.policy';
export { EksNodeOverprovisionedPolicy } from './policies/eks-node-overprovisioned.policy';
export { EksOrphanPvcPolicy } from './policies/eks-orphan-pvc.policy';
export { AmiUnusedPolicy } from './policies/ami-unused.policy';
export { EcrImageUntaggedPolicy } from './policies/ecr-image-untagged.policy';
export { S3MultipartUploadAbandonedPolicy } from './policies/s3-multipart-upload-abandoned.policy';
export { RdsManualSnapshotOldPolicy } from './policies/rds-manual-snapshot-old.policy';
export { SecretsManagerUnusedPolicy } from './policies/secretsmanager-unused.policy';
export { CodepipelinePipelineStalePolicy } from './policies/codepipeline-pipeline-stale.policy';

// Outbound Ports
export type { PricingPort } from './ports/outbound/pricing.port';
export type { WasteScannerPort } from './ports/outbound/waste-scanner.port';
export type {
  CostExplorerPort,
  CostByService,
  CostPeriodBucket,
} from './ports/outbound/cost-explorer.port';

// Inbound Ports
export type {
  FindWastedResourcesRequest,
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  ResourceScanError,
} from './ports/inbound/find-wasted-resources.use-case.port';
export type {
  CompareCostRequest,
  CompareCostUseCasePort,
} from './ports/inbound/compare-cost.use-case.port';
export type {
  CostTrendRequest,
  CostTrendUseCasePort,
} from './ports/inbound/cost-trend.use-case.port';

// Cost Analytics
export type {
  CostComparisonSummary,
  CostServiceDelta,
  CostPeriodTotal,
} from './cost-comparison';
export type { CostTrendSummary, CostTrendMonth } from './cost-trend';
