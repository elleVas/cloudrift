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
