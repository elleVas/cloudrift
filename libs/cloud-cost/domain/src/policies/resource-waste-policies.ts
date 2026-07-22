// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, waste, notWaste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { EbsVolume } from '../entities/ebs-volume.entity';
import type { ElasticIp } from '../entities/elastic-ip.entity';
import type { RdsInstance } from '../entities/rds-instance.entity';
import type { LoadBalancer } from '../entities/load-balancer.entity';
import type { Ec2Instance } from '../entities/ec2-instance.entity';
import type { EbsSnapshot } from '../entities/ebs-snapshot.entity';
import type { NatGateway } from '../entities/nat-gateway.entity';
import type { Gp2Volume } from '../entities/gp2-volume.entity';
import type { IdleEbsVolume } from '../entities/idle-ebs-volume.entity';
import type { UnderutilizedEc2Instance } from '../entities/underutilized-ec2-instance.entity';
import type { RdsUnderutilizedInstance } from '../entities/rds-underutilized-instance.entity';
import type { LogGroup } from '../entities/log-group.entity';
import type { OrphanedEni } from '../entities/orphaned-eni.entity';
import type { S3Bucket } from '../entities/s3-bucket.entity';
import type { UnderutilizedLambdaFunction } from '../entities/underutilized-lambda-function.entity';
import type { EfsFileSystem } from '../entities/efs-file-system.entity';
import type { OverprovisionedDynamoDbTable } from '../entities/overprovisioned-dynamodb-table.entity';
import type { IdleElastiCacheCluster } from '../entities/idle-elasticache-cluster.entity';
import type { RedshiftCluster } from '../entities/redshift-cluster.entity';
import type { OpenSearchDomain } from '../entities/opensearch-domain.entity';
import type { MskCluster } from '../entities/msk-cluster.entity';
import type { FsxFileSystem } from '../entities/fsx-file-system.entity';
import type { DocumentDbInstance } from '../entities/documentdb-instance.entity';
import type { NeptuneInstance } from '../entities/neptune-instance.entity';
import type { MqBroker } from '../entities/mq-broker.entity';
import type { Workspace } from '../entities/workspace.entity';
import type { VpnConnection } from '../entities/vpn-connection.entity';
import type { TransitGatewayAttachment } from '../entities/transit-gateway-attachment.entity';
import type { KinesisStream } from '../entities/kinesis-stream.entity';
import type { SqsDlqAbandoned } from '../entities/sqs-dlq-abandoned.entity';
import type { LambdaLogGroupOrphaned } from '../entities/lambda-loggroup-orphaned.entity';
import type { AuroraServerlessOverprovisioned } from '../entities/aurora-serverless-overprovisioned.entity';
import type { SageMakerNotebookIdle } from '../entities/sagemaker-notebook-idle.entity';
import type { SageMakerEndpointIdle } from '../entities/sagemaker-endpoint-idle.entity';
import type { SageMakerTrainingOrphaned } from '../entities/sagemaker-training-orphaned.entity';
import type { EnvironmentGhost } from '../entities/environment-ghost.entity';
import type { EksNodeOverprovisioned } from '../entities/eks-node-overprovisioned.entity';
import type { EksOrphanPvc } from '../entities/eks-orphan-pvc.entity';
import type { AmiUnused } from '../entities/ami-unused.entity';
import type { EcrImageUntagged } from '../entities/ecr-image-untagged.entity';
import type { S3MultipartUploadAbandoned } from '../entities/s3-multipart-upload-abandoned.entity';
import type { RdsManualSnapshotOld } from '../entities/rds-manual-snapshot-old.entity';
import type { SecretsManagerUnused } from '../entities/secretsmanager-unused.entity';

export class EbsVolumeWastePolicy extends WastePolicy<EbsVolume> {
  protected judge(volume: EbsVolume, now: Date): WasteVerdict {
    if (!volume.isUnattached()) return notWaste('volume is attached');
    // AWS does not expose the detach date: the volume's age is the only available proxy.
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('unattached');
  }
}

export class ElasticIpWastePolicy extends WastePolicy<ElasticIp> {
  protected judge(ip: ElasticIp): WasteVerdict {
    // Elastic IPs have no creation date: no grace period applicable.
    return ip.isUnassociated() ? waste('unassociated') : notWaste('associated');
  }
}

export class RdsInstanceWastePolicy extends WastePolicy<RdsInstance> {
  protected judge(db: RdsInstance): WasteVerdict {
    // AWS automatically restarts a stopped instance after 7 days: if we see it
    // stopped it is by definition recent, so the grace period does not apply.
    return db.isStopped()
      ? waste('stopped (storage and backups still billed)')
      : notWaste('not stopped');
  }
}

export class LoadBalancerWastePolicy extends WastePolicy<LoadBalancer> {
  protected judge(lb: LoadBalancer, now: Date): WasteVerdict {
    if (!lb.isIdle()) return notWaste('has registered targets');
    if (this.isWithinGracePeriod(lb.createdTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no registered targets');
  }
}

export class Ec2InstanceWastePolicy extends WastePolicy<Ec2Instance> {
  protected judge(instance: Ec2Instance, now: Date): WasteVerdict {
    if (!instance.isStopped()) return notWaste('not stopped');
    const stoppedSince = instance.stoppedSince ?? instance.launchTime;
    if (this.isWithinGracePeriod(stoppedSince, now)) {
      return notWaste(`stopped less than ${this.minAgeDays}d ago`);
    }
    return waste('stopped (attached EBS still billed)');
  }
}

export class EbsSnapshotWastePolicy extends WastePolicy<EbsSnapshot> {
  protected judge(snapshot: EbsSnapshot, now: Date): WasteVerdict {
    if (!snapshot.isOrphan()) return notWaste('source volume still exists');
    if (snapshot.boundToAmiId) {
      // A snapshot referenced by a registered AMI is not deletable.
      return notWaste(`in use by AMI ${snapshot.boundToAmiId}`);
    }
    if (this.isWithinGracePeriod(snapshot.startTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('source volume deleted');
  }
}

export class NatGatewayWastePolicy extends WastePolicy<NatGateway> {
  protected judge(gateway: NatGateway, now: Date): WasteVerdict {
    if (!gateway.isIdle()) return notWaste('has outbound traffic');
    // A gateway younger than the grace period might simply
    // not have received traffic yet (e.g. a newly created environment).
    if (this.isWithinGracePeriod(gateway.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero traffic in last ${gateway.metricWindowHours}h`);
  }
}

export class EbsIdlePolicy extends WastePolicy<IdleEbsVolume> {
  /** maxOps: threshold of total I/O operations below which the volume is idle. */
  constructor(options: WastePolicyOptions = {}, private readonly maxOps = 0) {
    super(options);
  }

  protected judge(volume: IdleEbsVolume, now: Date): WasteVerdict {
    if (volume.totalOps() > this.maxOps) return notWaste('has I/O activity');
    // A newly created volume might not have received I/O yet.
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero I/O in last ${volume.metricWindowHours}h`);
  }
}

export class Ec2UnderutilizedPolicy extends WastePolicy<UnderutilizedEc2Instance> {
  /** maxCpuPercent: maximum CPU threshold below which the instance is underutilized. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 5) {
    super(options);
  }

  protected judge(instance: UnderutilizedEc2Instance, now: Date): WasteVerdict {
    if (instance.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    // A just-launched instance might not have accumulated real traffic yet.
    if (this.isWithinGracePeriod(instance.launchTime, now)) {
      return notWaste(`launched less than ${this.minAgeDays}d ago`);
    }
    return waste(`max CPU ${instance.maxCpuPercent.toFixed(1)}% over ${instance.windowDays}d`);
  }
}

export class RdsUnderutilizedPolicy extends WastePolicy<RdsUnderutilizedInstance> {
  /** maxCpuPercent: maximum CPU threshold below which the RDS instance is underutilized. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 5) {
    super(options);
  }

  protected judge(instance: RdsUnderutilizedInstance, now: Date): WasteVerdict {
    if (instance.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    // A just-created instance might not have accumulated real traffic yet.
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`max CPU ${instance.maxCpuPercent.toFixed(1)}% over ${instance.windowDays}d`);
  }
}

export class LogGroupWastePolicy extends WastePolicy<LogGroup> {
  protected judge(group: LogGroup, now: Date): WasteVerdict {
    if (group.hasRetentionPolicy()) return notWaste('retention policy configured');
    if (this.isWithinGracePeriod(group.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no retention policy');
  }
}

export class OrphanedEniWastePolicy extends WastePolicy<OrphanedEni> {
  protected judge(eni: OrphanedEni): WasteVerdict {
    // ENIs do not expose a creation date: no grace period applicable.
    return eni.isOrphaned() ? waste('not attached') : notWaste('attached');
  }
}

export class S3NoLifecyclePolicy extends WastePolicy<S3Bucket> {
  protected judge(bucket: S3Bucket, now: Date): WasteVerdict {
    if (bucket.hasLifecyclePolicy()) return notWaste('lifecycle policy configured');
    if (this.isWithinGracePeriod(bucket.creationDate, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no lifecycle policy');
  }
}

export class LambdaUnderutilizedPolicy extends WastePolicy<UnderutilizedLambdaFunction> {
  /** maxInvocations: maximum invocations threshold below which the function is underutilized. */
  constructor(options: WastePolicyOptions = {}, private readonly maxInvocations = 0) {
    super(options);
  }

  protected judge(fn: UnderutilizedLambdaFunction, now: Date): WasteVerdict {
    if (fn.invocationsLastWindow > this.maxInvocations) return notWaste('invocations above threshold');
    // A just-deployed function might not have received real traffic yet.
    if (this.isWithinGracePeriod(fn.lastModified, now)) {
      return notWaste(`last modified less than ${this.minAgeDays}d ago`);
    }
    return waste(`${fn.invocationsLastWindow} invocations over ${fn.windowDays}d`);
  }
}

export class EfsUnusedPolicy extends WastePolicy<EfsFileSystem> {
  /** maxIoBytes: total I/O threshold below which a mounted file system is idle. */
  constructor(options: WastePolicyOptions = {}, private readonly maxIoBytes = 0) {
    super(options);
  }

  protected judge(fs: EfsFileSystem, now: Date): WasteVerdict {
    const idle = !fs.hasNoMountTargets() && fs.ioBytesLastWindow <= this.maxIoBytes;
    if (!fs.hasNoMountTargets() && !idle) return notWaste('has I/O activity');
    if (this.isWithinGracePeriod(fs.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return fs.hasNoMountTargets() ? waste('no mount targets') : waste(`zero I/O in last ${fs.metricWindowHours}h`);
  }
}

export class DynamoDbOverprovisionedPolicy extends WastePolicy<OverprovisionedDynamoDbTable> {
  /** maxUtilizationPercent: maximum utilization threshold (read and write) below which the table is overprovisioned. */
  constructor(options: WastePolicyOptions = {}, private readonly maxUtilizationPercent = 10) {
    super(options);
  }

  protected judge(table: OverprovisionedDynamoDbTable, now: Date): WasteVerdict {
    if (
      table.avgReadUtilizationPercent >= this.maxUtilizationPercent ||
      table.avgWriteUtilizationPercent >= this.maxUtilizationPercent
    ) {
      return notWaste('utilization above threshold');
    }
    // A just-created table might not have accumulated real traffic yet.
    if (this.isWithinGracePeriod(table.creationDateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(
      `read ${table.avgReadUtilizationPercent.toFixed(1)}% / write ${table.avgWriteUtilizationPercent.toFixed(1)}% over ${table.windowDays}d`,
    );
  }
}

export class ElastiCacheIdlePolicy extends WastePolicy<IdleElastiCacheCluster> {
  protected judge(cluster: IdleElastiCacheCluster, now: Date): WasteVerdict {
    if (!cluster.isIdle()) return notWaste('has client connections');
    // A just-created cluster might not have received connections yet.
    if (this.isWithinGracePeriod(cluster.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero connections in last ${cluster.metricWindowHours}h`);
  }
}

export class RedshiftIdleClusterPolicy extends WastePolicy<RedshiftCluster> {
  protected judge(cluster: RedshiftCluster, now: Date): WasteVerdict {
    if (!cluster.isIdle()) return notWaste('has database connections');
    if (this.isWithinGracePeriod(cluster.clusterCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero connections in last ${cluster.metricWindowHours}h`);
  }
}

export class OpenSearchIdleDomainPolicy extends WastePolicy<OpenSearchDomain> {
  protected judge(domain: OpenSearchDomain): WasteVerdict {
    // DescribeDomains exposes no creation date: no grace period applicable.
    return domain.isIdle() ? waste('no search/indexing traffic') : notWaste('has search/indexing traffic');
  }
}

export class MskIdleClusterPolicy extends WastePolicy<MskCluster> {
  protected judge(cluster: MskCluster, now: Date): WasteVerdict {
    if (!cluster.isIdle()) return notWaste('has broker traffic');
    if (this.isWithinGracePeriod(cluster.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero broker traffic in last ${cluster.metricWindowHours}h`);
  }
}

export class FsxIdleFilesystemPolicy extends WastePolicy<FsxFileSystem> {
  protected judge(fs: FsxFileSystem, now: Date): WasteVerdict {
    if (!fs.isIdle()) return notWaste('has I/O activity');
    if (this.isWithinGracePeriod(fs.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero I/O in last ${fs.metricWindowHours}h`);
  }
}

export class DocumentDbIdleInstancePolicy extends WastePolicy<DocumentDbInstance> {
  protected judge(instance: DocumentDbInstance, now: Date): WasteVerdict {
    if (!instance.isIdle()) return notWaste('has database connections');
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero connections in last ${instance.metricWindowHours}h`);
  }
}

export class NeptuneIdleInstancePolicy extends WastePolicy<NeptuneInstance> {
  protected judge(instance: NeptuneInstance, now: Date): WasteVerdict {
    if (!instance.isIdle()) return notWaste('has query traffic');
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero query traffic in last ${instance.metricWindowHours}h`);
  }
}

export class MqIdleBrokerPolicy extends WastePolicy<MqBroker> {
  protected judge(broker: MqBroker, now: Date): WasteVerdict {
    if (!broker.isIdle()) return notWaste('has network traffic');
    if (this.isWithinGracePeriod(broker.created, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero network traffic in last ${broker.metricWindowHours}h`);
  }
}

export class WorkspacesIdlePolicy extends WastePolicy<Workspace> {
  /** windowDays: days since the last user connection below which an AlwaysOn WorkSpace is "idle". */
  constructor(options: WastePolicyOptions = {}, private readonly windowDays = 30) {
    super(options);
  }

  protected judge(workspace: Workspace, now: Date): WasteVerdict {
    return workspace.isIdle(now, this.windowDays)
      ? waste(workspace.wasteReason)
      : notWaste('user connected within the window');
  }
}

export class VpnConnectionIdlePolicy extends WastePolicy<VpnConnection> {
  protected judge(connection: VpnConnection): WasteVerdict {
    // DescribeVpnConnections exposes no creation date: no grace period applicable.
    return connection.isIdle()
      ? waste(`zero tunnel traffic in last ${connection.metricWindowHours}h`)
      : notWaste('has tunnel traffic');
  }
}

export class TransitGatewayIdleAttachmentPolicy extends WastePolicy<TransitGatewayAttachment> {
  protected judge(attachment: TransitGatewayAttachment, now: Date): WasteVerdict {
    if (!attachment.isIdle()) return notWaste('has traffic');
    if (this.isWithinGracePeriod(attachment.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero traffic in last ${attachment.metricWindowHours}h`);
  }
}

export class KinesisProvisionedIdleStreamPolicy extends WastePolicy<KinesisStream> {
  protected judge(stream: KinesisStream, now: Date): WasteVerdict {
    if (!stream.isIdle()) return notWaste('has incoming records');
    if (this.isWithinGracePeriod(stream.streamCreationTimestamp, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero incoming records in last ${stream.metricWindowHours}h`);
  }
}

export class SqsDlqAbandonedWastePolicy extends WastePolicy<SqsDlqAbandoned> {
  /** minMessageAgeDays: age of the oldest unconsumed message, not resource age — `minAgeDays`'s grace period does not apply here. */
  constructor(options: WastePolicyOptions = {}, private readonly minMessageAgeDays = 14) {
    super(options);
  }

  protected judge(queue: SqsDlqAbandoned): WasteVerdict {
    if (!queue.identifiedAsDlq) return notWaste('not identified as a DLQ');
    if (queue.approximateNumberOfMessages === 0) return notWaste('no messages');
    const ageDays = queue.oldestMessageAgeSeconds / 86400;
    if (ageDays < this.minMessageAgeDays) {
      return notWaste(`oldest message ${ageDays.toFixed(1)}d old, within ${this.minMessageAgeDays}d grace period`);
    }
    return waste(`oldest message ${ageDays.toFixed(1)}d old, ${queue.approximateNumberOfMessages} unconsumed`);
  }
}

export class LambdaLogGroupOrphanedPolicy extends WastePolicy<LambdaLogGroupOrphaned> {
  protected judge(group: LambdaLogGroupOrphaned, now: Date): WasteVerdict {
    if (group.functionExists) return notWaste('function still exists');
    // `null` means no log stream ever recorded an event — that's stronger
    // evidence of orphan status than a recent timestamp, so no grace period
    // applies (unlike a real but recent last-event date).
    if (group.lastEventTimestamp && this.isWithinGracePeriod(group.lastEventTimestamp, now)) {
      return notWaste(`last log event less than ${this.minAgeDays}d ago`);
    }
    return waste(`function ${group.functionName} no longer exists`);
  }
}

export class AuroraServerlessOverprovisionedPolicy extends WastePolicy<AuroraServerlessOverprovisioned> {
  /** minAcuUtilizationPercent: peak-to-Min-ACU ratio (%) below which the floor is "overprovisioned". Default 50. */
  constructor(options: WastePolicyOptions = {}, private readonly minAcuUtilizationPercent = 50) {
    super(options);
  }

  protected judge(cluster: AuroraServerlessOverprovisioned, now: Date): WasteVerdict {
    // A missing datapoint is "no evidence", not "confirmed zero load" — unlike
    // the zero-activity scanners, flagging on it would recommend slashing
    // Min ACU off a metric CloudWatch never actually reported.
    if (!cluster.hasDatapoint) return notWaste('no ServerlessDatabaseCapacity datapoint in window');
    if (cluster.peakAcu >= cluster.minAcu * (this.minAcuUtilizationPercent / 100)) {
      return notWaste('peak ACU above threshold');
    }
    // After rounding the suggestion up to AWS's 0.5 ACU granularity there may
    // be nothing left to lower (e.g. Min ACU already at the 0.5 floor).
    if (cluster.suggestedMinAcu >= cluster.minAcu) {
      return notWaste('no Min ACU reduction available');
    }
    // A just-created cluster might not have reached its real peak load yet.
    if (this.isWithinGracePeriod(cluster.clusterCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`peak ${cluster.peakAcu.toFixed(2)} ACU / Min ACU ${cluster.minAcu} over ${cluster.windowHours}h`);
  }
}

export class SageMakerNotebookIdlePolicy extends WastePolicy<SageMakerNotebookIdle> {
  /** maxCpuPercent: maximum CPU threshold below which an InService notebook is "idle". Default 2. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 2) {
    super(options);
  }

  protected judge(notebook: SageMakerNotebookIdle, now: Date): WasteVerdict {
    if (notebook.status !== 'InService') return notWaste(`status is ${notebook.status}, not InService`);
    if (notebook.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    if (this.isWithinGracePeriod(notebook.lastModifiedTime, now)) {
      return notWaste(`last modified less than ${this.minAgeDays}d ago`);
    }
    return waste(`InService, max CPU ${notebook.maxCpuPercent.toFixed(1)}% over ${notebook.windowHours}h`);
  }
}

export class SageMakerEndpointIdlePolicy extends WastePolicy<SageMakerEndpointIdle> {
  protected judge(endpoint: SageMakerEndpointIdle, now: Date): WasteVerdict {
    if (endpoint.status !== 'InService') return notWaste(`status is ${endpoint.status}, not InService`);
    if (endpoint.invocationsLastWindow > 0) return notWaste('has invocations');
    if (this.isWithinGracePeriod(endpoint.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`InService, zero invocations over ${endpoint.windowHours}h`);
  }
}

export class SageMakerTrainingOrphanedPolicy extends WastePolicy<SageMakerTrainingOrphaned> {
  protected judge(model: SageMakerTrainingOrphaned, now: Date): WasteVerdict {
    if (model.referencedByEndpointConfig) return notWaste('referenced by an endpoint config');
    if (this.isWithinGracePeriod(model.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('not referenced by any endpoint config');
  }
}

export class EnvironmentGhostPolicy extends WastePolicy<EnvironmentGhost> {
  /** inactivityDays: how long every resource in the group must have looked inactive before the group is "ghost". Default 7 — distinct from `minAgeDays`, which the base class's grace period does not apply here (there is no single "creation date" for a heterogeneous group). */
  constructor(options: WastePolicyOptions = {}, private readonly inactivityDays = 7) {
    super(options);
  }

  protected judge(env: EnvironmentGhost, now: Date): WasteVerdict {
    if (env.resourceCount === 0) {
      return notWaste('no evaluable resources in group (unsupported types only)');
    }
    if (env.inactiveResourceCount < env.resourceCount) {
      return notWaste('at least one resource still active');
    }
    const idleDays = this.ageInDays(env.lastActivityTimestamp, now);
    if (idleDays < this.inactivityDays) {
      return notWaste(`inactive ${idleDays.toFixed(1)}d, within ${this.inactivityDays}d threshold`);
    }
    return waste(
      `${env.resourceCount} resource(s) (${env.resourceTypes.join(', ')}) inactive for ${idleDays.toFixed(1)}d`,
    );
  }
}

export class EksNodeOverprovisionedPolicy extends WastePolicy<EksNodeOverprovisioned> {
  /** cpuUtilizationPercent: CPU-requested-to-allocatable ratio (%) below which a node group is "overprovisioned". Default 30. */
  constructor(options: WastePolicyOptions = {}, private readonly cpuUtilizationPercent = 30) {
    super(options);
  }

  protected judge(nodegroup: EksNodeOverprovisioned, now: Date): WasteVerdict {
    // No Container Insights datapoint is "no evidence" (likely not enabled
    // on the cluster), not "confirmed zero requests" — same reasoning as
    // AuroraServerlessOverprovisionedPolicy's hasDatapoint guard.
    if (!nodegroup.hasDatapoint) return notWaste('no Container Insights datapoint in window');
    if (nodegroup.cpuRequestedPercent >= this.cpuUtilizationPercent) {
      return notWaste('CPU requested above threshold');
    }
    if (nodegroup.suggestedNodeCount >= nodegroup.nodeCount) {
      return notWaste('no node count reduction available');
    }
    if (this.isWithinGracePeriod(nodegroup.nodegroupCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(
      `CPU requested ${nodegroup.cpuRequestedPercent.toFixed(1)}% of allocatable across ${nodegroup.nodeCount} node(s) over ${nodegroup.windowHours}h`,
    );
  }
}

export class EksOrphanPvcPolicy extends WastePolicy<EksOrphanPvc> {
  protected judge(volume: EksOrphanPvc, now: Date): WasteVerdict {
    const orphanedByMissingCluster = volume.isOrphanedByMissingCluster;
    if (!volume.isUnattached() && !orphanedByMissingCluster) {
      return notWaste('attached and owning cluster still exists (or unknown)');
    }
    if (this.isWithinGracePeriod(volume.createdTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return orphanedByMissingCluster
      ? waste(`owning EKS cluster "${volume.clusterName}" no longer exists`)
      : waste('unattached (Kubernetes PVC volume, no Pod using it)');
  }
}

// Added 2026-07-22.

export class AmiUnusedPolicy extends WastePolicy<AmiUnused> {
  protected judge(ami: AmiUnused, now: Date): WasteVerdict {
    if (!ami.isUnused()) return notWaste('referenced by an instance or launch template');
    if (this.isWithinGracePeriod(ami.creationDate, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('not referenced by any instance or launch template');
  }
}

export class EcrImageUntaggedPolicy extends WastePolicy<EcrImageUntagged> {
  protected judge(image: EcrImageUntagged, now: Date): WasteVerdict {
    // The scanner only builds entities for already-untagged images; we only
    // apply the grace period so as not to flag an image mid-push/mid-CI-tag.
    if (this.isWithinGracePeriod(image.imagePushedAt, now)) {
      return notWaste(`pushed less than ${this.minAgeDays}d ago`);
    }
    return waste('no image tag');
  }
}

export class S3MultipartUploadAbandonedPolicy extends WastePolicy<S3MultipartUploadAbandoned> {
  protected judge(upload: S3MultipartUploadAbandoned, now: Date): WasteVerdict {
    // Every upload the scanner sees is by definition incomplete (still
    // listed by ListMultipartUploads); we only apply the grace period so as
    // not to flag an upload still actively in progress.
    if (this.isWithinGracePeriod(upload.initiated, now)) {
      return notWaste(`initiated less than ${this.minAgeDays}d ago`);
    }
    return waste('incomplete multipart upload past the grace period');
  }
}

export class RdsManualSnapshotOldPolicy extends WastePolicy<RdsManualSnapshotOld> {
  protected judge(snapshot: RdsManualSnapshotOld, now: Date): WasteVerdict {
    if (this.isWithinGracePeriod(snapshot.snapshotCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`manual snapshot ${this.ageInDays(snapshot.snapshotCreateTime, now).toFixed(0)}d old`);
  }
}

export class SecretsManagerUnusedPolicy extends WastePolicy<SecretsManagerUnused> {
  /** unusedDays: days since last access (or creation, if never accessed) after which a secret is "unused". Default 30 — longer than the base grace period, since infrequent-but-legitimate access patterns exist; `minAgeDays`'s grace period does not apply here (same reasoning as SqsDlqAbandonedWastePolicy). */
  constructor(options: WastePolicyOptions = {}, private readonly unusedDays = 30) {
    super(options);
  }

  protected judge(secret: SecretsManagerUnused, now: Date): WasteVerdict {
    const referenceDate = secret.lastAccessedDate ?? secret.createdDate;
    const idleDays = this.ageInDays(referenceDate, now);
    if (idleDays < this.unusedDays) {
      return notWaste(
        `${secret.lastAccessedDate ? 'last accessed' : 'created'} ${idleDays.toFixed(1)}d ago, within ${this.unusedDays}d threshold`,
      );
    }
    return waste(`${secret.wasteReason}, ${idleDays.toFixed(1)}d`);
  }
}

export class Gp2UpgradePolicy extends WastePolicy<Gp2Volume> {
  protected judge(volume: Gp2Volume, now: Date): WasteVerdict {
    // The server-side prefilter already guarantees volume-type=gp2 in-use;
    // we only apply the grace period so as not to flag resources that
    // were just created (infrastructure still being set up).
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('gp2 volume upgradeable to gp3');
  }
}
