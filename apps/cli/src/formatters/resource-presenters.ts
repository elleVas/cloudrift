// SPDX-License-Identifier: Apache-2.0
import type { ResourceKind, ResourceKindMap, WastedResource } from 'cloud-cost-domain';

/**
 * Presentation per resource type, shared by the console and PDF formatters.
 * Adding a new ResourceKind forces (via the compiler) adding the
 * corresponding presenter here — the single point of change on the CLI side.
 */
export interface ResourcePresenter<T extends WastedResource = WastedResource> {
  title: string;
  /** Column headers, cost excluded (added by the formatters as the last column). */
  head: string[];
  /** PDF column widths; the last element is the cost column. */
  colWidths: number[];
  row(resource: T): string[];
  recommend(resource: T): string;
}

function day(date: Date): string {
  return date.toISOString().split('T')[0];
}

function clusterDisplay(clusterName: string | undefined, clusterExists: boolean): string {
  if (clusterName === undefined) return 'unknown';
  return clusterExists ? clusterName : `${clusterName} (deleted)`;
}

/**
 * `Name` tag alongside an opaque AWS-generated ID (`vol-…`, `i-…`, `eni-…`) so
 * the resource is recognizable at a glance, without replacing the ID itself —
 * the ID stays the reliable value to paste into the AWS console search.
 */
function tagName(tags: Record<string, string>): string {
  return tags.Name || '—';
}

type PresenterMap = { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> };

export const presenters: PresenterMap = {
  'ebs-volume': {
    title: 'EBS Volumes — Unattached',
    head: ['Volume ID', 'Name', 'Region', 'Size', 'Type', 'Created'],
    colWidths: [135, 90, 80, 48, 48, 84, 80],
    row: (v) => [v.id, tagName(v.tags), v.region.code, `${v.sizeGb} GB`, v.volumeType, day(v.createTime)],
    recommend: (v) =>
      `Delete unattached EBS ${v.id} — ${v.sizeGb} GB ${v.volumeType} in ${v.region.code}`,
  },
  'elastic-ip': {
    title: 'Elastic IPs — Unassociated',
    head: ['Allocation ID', 'Name', 'Region', 'Public IP'],
    colWidths: [175, 90, 84, 156, 80],
    row: (ip) => [ip.id, tagName(ip.tags), ip.region.code, ip.publicIp],
    recommend: (ip) =>
      `Release unassociated Elastic IP ${ip.publicIp} (${ip.id}) in ${ip.region.code}`,
  },
  'rds-instance': {
    title: 'RDS Instances — Stopped',
    head: ['Identifier', 'Region', 'Class', 'Engine', 'Storage'],
    colWidths: [125, 72, 82, 68, 80, 68],
    row: (db) => [
      db.id,
      db.region.code,
      db.dbInstanceClass,
      db.engine,
      `${db.allocatedStorageGb} GB ${db.storageType}`,
    ],
    recommend: (db) =>
      `Terminate or snapshot stopped RDS ${db.id} (${db.dbInstanceClass} ${db.engine}) in ${db.region.code}`,
  },
  'load-balancer': {
    title: 'Load Balancers — Idle (no registered targets)',
    head: ['Name', 'Region', 'Type', 'Created'],
    colWidths: [175, 84, 64, 90, 82],
    row: (lb) => [lb.name, lb.region.code, lb.type, day(lb.createdTime)],
    recommend: (lb) =>
      `Delete idle ${lb.type} Load Balancer "${lb.name}" in ${lb.region.code}`,
  },
  'ec2-instance': {
    title: 'EC2 Instances — Stopped (EBS still billed)',
    head: ['Instance ID', 'Name', 'Region', 'Type', 'Volumes', 'Stopped since'],
    colWidths: [110, 90, 72, 62, 115, 80, 56],
    row: (inst) => [
      inst.id,
      tagName(inst.tags),
      inst.region.code,
      inst.instanceType,
      inst.attachedVolumes.length === 0
        ? 'none'
        : inst.attachedVolumes.map((v) => `${v.sizeGb}GB ${v.volumeType}`).join(', '),
      day(inst.stoppedSince ?? inst.launchTime),
    ],
    recommend: (inst) =>
      `Terminate stopped EC2 ${inst.id} (${inst.instanceType}, ${inst.region.code}) — ${inst.attachedVolumes.length} volume(s) still billed`,
  },
  'ebs-snapshot': {
    title: 'EBS Snapshots — Orphaned (source volume deleted)',
    head: ['Snapshot ID', 'Name', 'Region', 'Source Volume', 'Size', 'Created'],
    colWidths: [115, 90, 72, 112, 48, 80, 68],
    row: (snap) => [
      snap.id,
      tagName(snap.tags),
      snap.region.code,
      snap.sourceVolumeId,
      `${snap.sizeGb} GB`,
      day(snap.startTime),
    ],
    recommend: (snap) =>
      `Delete orphan snapshot ${snap.id} (${snap.sizeGb} GB) in ${snap.region.code} — source volume deleted`,
  },
  'nat-gateway': {
    title: 'NAT Gateways — Idle',
    head: ['NAT Gateway ID', 'Name', 'Region', 'VPC', 'Created'],
    colWidths: [130, 90, 70, 140, 80, 75],
    row: (gw) => [gw.id, tagName(gw.tags), gw.region.code, gw.vpcId, day(gw.createTime)],
    recommend: (gw) =>
      `Delete idle NAT Gateway ${gw.id} in ${gw.region.code} — ${gw.wasteReason}`,
  },
  'ebs-gp2-upgrade': {
    title: 'EBS Volumes — gp2→gp3 upgrade (savings opportunity, not deletable waste)',
    head: ['Volume ID', 'Name', 'Region', 'Size', 'Created'],
    colWidths: [170, 90, 90, 60, 96, 80],
    row: (v) => [v.id, tagName(v.tags), v.region.code, `${v.sizeGb} GB`, day(v.createTime)],
    recommend: (v) =>
      `Modify EBS ${v.id} (${v.sizeGb} GB gp2) in ${v.region.code} to gp3 — saves ${v.costEstimate.format()}, no downtime`,
  },
  'ebs-idle': {
    title: 'EBS Volumes — Idle (attached, no I/O)',
    head: ['Volume ID', 'Name', 'Region', 'Size', 'Type', 'Attached to'],
    colWidths: [130, 90, 72, 56, 50, 130, 70],
    row: (v) => [
      v.id,
      tagName(v.tags),
      v.region.code,
      `${v.sizeGb} GB`,
      v.volumeType,
      v.attachedInstanceId ?? '—',
    ],
    recommend: (v) =>
      `Detach or delete idle EBS ${v.id} (${v.sizeGb} GB ${v.volumeType}) in ${v.region.code} — no I/O in last ${v.metricWindowHours}h`,
  },
  'ec2-underutilized': {
    title: 'EC2 Instances — Underutilized (rightsizing candidate, verify before acting)',
    head: ['Instance ID', 'Name', 'Region', 'Type', 'Avg CPU', 'Max CPU', 'Window'],
    colWidths: [110, 90, 72, 70, 70, 70, 60, 80],
    row: (inst) => [
      inst.id,
      tagName(inst.tags),
      inst.region.code,
      inst.instanceType,
      `${inst.avgCpuPercent.toFixed(1)}%`,
      `${inst.maxCpuPercent.toFixed(1)}%`,
      `${inst.windowDays}d`,
    ],
    recommend: (inst) =>
      `Review EC2 ${inst.id} (${inst.instanceType}) in ${inst.region.code} for rightsizing — max CPU ${inst.maxCpuPercent.toFixed(1)}% over ${inst.windowDays}d (verify RAM/network first)`,
  },
  'rds-underutilized': {
    title: 'RDS Instances — Underutilized (rightsizing candidate, verify before acting)',
    head: ['Identifier', 'Region', 'Class', 'Engine', 'Avg CPU', 'Max CPU', 'Window'],
    colWidths: [110, 72, 82, 68, 70, 70, 60, 80],
    row: (db) => [
      db.id,
      db.region.code,
      db.dbInstanceClass,
      db.engine,
      `${db.avgCpuPercent.toFixed(1)}%`,
      `${db.maxCpuPercent.toFixed(1)}%`,
      `${db.windowDays}d`,
    ],
    recommend: (db) =>
      `Review RDS ${db.id} (${db.dbInstanceClass} ${db.engine}) in ${db.region.code} for rightsizing — max CPU ${db.maxCpuPercent.toFixed(1)}% over ${db.windowDays}d (verify storage I/O/connections first)`,
  },
  'log-group': {
    title: 'CloudWatch Log Groups — No retention policy',
    head: ['Log Group', 'Region', 'Stored', 'Created'],
    colWidths: [190, 70, 70, 84, 85],
    row: (lg) => [
      lg.id,
      lg.region.code,
      `${(lg.storedBytes / 1024 ** 3).toFixed(1)} GB`,
      day(lg.creationTime),
    ],
    recommend: (lg) =>
      `Set a retention policy on log group ${lg.id} in ${lg.region.code}`,
  },
  'eni-orphaned': {
    title: 'Orphaned ENIs — Not attached (hygiene, no direct cost)',
    head: ['Network Interface ID', 'Name', 'Region', 'VPC', 'Subnet'],
    // Subnet IDs ("subnet-...") are the longest of the four ID-like values
    // here (24 chars vs. 21 for eni-/vpc-), so they need the widest column —
    // it was previously tied with VPC while Network Interface ID (also 21
    // chars) was overallocated, clipping the subnet column.
    colWidths: [115, 90, 65, 110, 140, 65],
    row: (eni) => [eni.id, tagName(eni.tags), eni.region.code, eni.vpcId, eni.subnetId],
    recommend: (eni) =>
      `Delete orphaned ENI ${eni.id} in ${eni.region.code} — not attached to any instance`,
  },
  's3-no-lifecycle': {
    title: 'S3 Buckets — No lifecycle policy (rightsizing candidate, verify before acting)',
    head: ['Bucket', 'Region', 'Size', 'Created'],
    colWidths: [180, 80, 70, 90, 85],
    row: (b) => [
      b.id,
      b.region.code,
      `${(b.sizeBytes / 1024 ** 3).toFixed(1)} GB`,
      day(b.creationDate),
    ],
    recommend: (b) =>
      `Configure a lifecycle policy on bucket ${b.id} in ${b.region.code} — ${(b.sizeBytes / 1024 ** 3).toFixed(1)} GB with no tiering/expiration rule`,
  },
  'lambda-underutilized': {
    title: 'Lambda Functions — Underutilized (hygiene flag, no direct cost)',
    head: ['Function', 'Region', 'Memory', 'Invocations', 'Window'],
    colWidths: [180, 80, 70, 90, 70, 70],
    row: (fn) => [
      fn.id,
      fn.region.code,
      `${fn.memorySizeMb} MB`,
      `${fn.invocationsLastWindow}`,
      `${fn.windowDays}d`,
    ],
    recommend: (fn) =>
      `Review Lambda ${fn.id} in ${fn.region.code} — ${fn.invocationsLastWindow} invocations over ${fn.windowDays}d, consider removing if dead code`,
  },
  'efs-unused': {
    title: 'EFS File Systems — Unused (no mount targets or zero I/O)',
    head: ['File System ID', 'Name', 'Region', 'Size', 'Mount Targets'],
    colWidths: [140, 90, 80, 70, 100, 80],
    row: (fs) => [
      fs.id,
      tagName(fs.tags),
      fs.region.code,
      `${(fs.sizeBytes / 1024 ** 3).toFixed(1)} GB`,
      `${fs.numberOfMountTargets}`,
    ],
    recommend: (fs) =>
      `Delete unused EFS ${fs.id} in ${fs.region.code} — ${fs.wasteReason}`,
  },
  'dynamodb-overprovisioned': {
    title: 'DynamoDB Tables — Overprovisioned (rightsizing candidate, verify before acting)',
    head: ['Table', 'Region', 'RCU', 'WCU', 'Read %', 'Write %', 'Window'],
    colWidths: [150, 72, 50, 50, 70, 70, 60, 80],
    row: (t) => [
      t.id,
      t.region.code,
      `${t.readCapacityUnits}`,
      `${t.writeCapacityUnits}`,
      `${t.avgReadUtilizationPercent.toFixed(1)}%`,
      `${t.avgWriteUtilizationPercent.toFixed(1)}%`,
      `${t.windowDays}d`,
    ],
    recommend: (t) =>
      `Review DynamoDB table ${t.id} in ${t.region.code} for rightsizing — ${t.wasteReason}`,
  },
  'elasticache-idle': {
    title: 'ElastiCache Clusters — Idle (zero connections)',
    head: ['Cluster ID', 'Region', 'Node Type', 'Nodes', 'Created'],
    colWidths: [140, 72, 90, 50, 84, 80],
    row: (c) => [
      c.id,
      c.region.code,
      c.cacheNodeType,
      `${c.numCacheNodes}`,
      c.createTime.toISOString().split('T')[0],
    ],
    recommend: (c) =>
      `Delete idle ElastiCache cluster ${c.id} (${c.cacheNodeType}) in ${c.region.code} — ${c.wasteReason}`,
  },
  'redshift-idle-cluster': {
    title: 'Redshift Clusters — Idle (zero connections, requires --live-pricing)',
    head: ['Cluster Identifier', 'Region', 'Node Type', 'Nodes', 'Created'],
    colWidths: [130, 70, 90, 50, 84, 80],
    row: (c) => [c.id, c.region.code, c.nodeType, `${c.numberOfNodes}`, day(c.clusterCreateTime)],
    recommend: (c) =>
      `Delete or pause idle Redshift cluster ${c.id} (${c.nodeType}) in ${c.region.code} — ${c.wasteReason}`,
  },
  'opensearch-idle-domain': {
    title: 'OpenSearch Domains — Idle (near-zero search/indexing traffic, requires --live-pricing)',
    head: ['Domain', 'Region', 'Instance Type', 'Instances'],
    colWidths: [140, 80, 100, 60, 80],
    row: (d) => [d.id, d.region.code, d.instanceType, `${d.instanceCount}`],
    recommend: (d) =>
      `Delete idle OpenSearch domain ${d.id} (${d.instanceType}) in ${d.region.code} — ${d.wasteReason}`,
  },
  'msk-idle-cluster': {
    title: 'MSK Clusters — Idle (zero broker traffic, requires --live-pricing)',
    head: ['Cluster Name', 'Region', 'Broker Type', 'Brokers', 'Created'],
    colWidths: [140, 70, 90, 50, 84, 80],
    row: (c) => [c.id, c.region.code, c.brokerInstanceType, `${c.numberOfBrokerNodes}`, day(c.creationTime)],
    recommend: (c) =>
      `Delete idle MSK cluster ${c.id} (${c.brokerInstanceType}) in ${c.region.code} — ${c.wasteReason}`,
  },
  'fsx-idle-filesystem': {
    title: 'FSx File Systems — Idle (zero I/O)',
    head: ['File System ID', 'Name', 'Region', 'Type', 'Size', 'Created'],
    colWidths: [130, 90, 70, 70, 60, 84, 80],
    row: (fs) => [
      fs.id,
      tagName(fs.tags),
      fs.region.code,
      fs.fileSystemType,
      `${fs.storageCapacityGiB} GiB`,
      day(fs.creationTime),
    ],
    recommend: (fs) =>
      `Delete idle FSx file system ${fs.id} (${fs.fileSystemType}) in ${fs.region.code} — ${fs.wasteReason}`,
  },
  'documentdb-idle-instance': {
    title: 'DocumentDB Instances — Idle (zero connections, requires --live-pricing)',
    head: ['Identifier', 'Region', 'Class', 'Created'],
    colWidths: [130, 70, 90, 84, 80],
    row: (db) => [db.id, db.region.code, db.dbInstanceClass, day(db.instanceCreateTime)],
    recommend: (db) =>
      `Delete idle DocumentDB instance ${db.id} (${db.dbInstanceClass}) in ${db.region.code} — ${db.wasteReason}`,
  },
  'neptune-idle-instance': {
    title: 'Neptune Instances — Idle (zero query traffic, requires --live-pricing)',
    head: ['Identifier', 'Region', 'Class', 'Created'],
    colWidths: [130, 70, 90, 84, 80],
    row: (db) => [db.id, db.region.code, db.dbInstanceClass, day(db.instanceCreateTime)],
    recommend: (db) =>
      `Delete idle Neptune instance ${db.id} (${db.dbInstanceClass}) in ${db.region.code} — ${db.wasteReason}`,
  },
  'mq-idle-broker': {
    title: 'Amazon MQ Brokers — Idle (zero network traffic, requires --live-pricing)',
    head: ['Broker', 'Region', 'Instance Type', 'Deployment', 'Created'],
    colWidths: [130, 70, 90, 90, 84, 70],
    row: (b) => [b.brokerName, b.region.code, b.hostInstanceType, b.deploymentMode, day(b.created)],
    recommend: (b) =>
      `Delete idle MQ broker ${b.brokerName} (${b.hostInstanceType}) in ${b.region.code} — ${b.wasteReason}`,
  },
  'workspaces-idle': {
    title: 'WorkSpaces — Idle (AlwaysOn, no recent user connection, requires --live-pricing)',
    head: ['WorkSpace ID', 'User', 'Region', 'Compute Type', 'Last Connection'],
    colWidths: [130, 90, 70, 90, 100, 80],
    row: (w) => [
      w.id,
      w.userName,
      w.region.code,
      w.computeTypeName,
      w.lastKnownUserConnectionTimestamp ? day(w.lastKnownUserConnectionTimestamp) : 'never',
    ],
    recommend: (w) =>
      `Terminate or convert to AutoStop idle WorkSpace ${w.id} (${w.computeTypeName}) in ${w.region.code} — ${w.wasteReason}`,
  },
  'vpn-connection-idle': {
    title: 'Site-to-Site VPN Connections — Idle (zero tunnel traffic)',
    head: ['VPN Connection ID', 'Name', 'Region', 'Gateway'],
    colWidths: [140, 90, 80, 160, 80],
    row: (v) => [v.id, tagName(v.tags), v.region.code, v.transitGatewayId ?? v.vpnGatewayId ?? 'unknown'],
    recommend: (v) =>
      `Delete idle VPN connection ${v.id} in ${v.region.code} — ${v.wasteReason}`,
  },
  'transit-gateway-idle-attachment': {
    title: 'Transit Gateway Attachments — Idle (zero traffic)',
    head: ['Attachment ID', 'Name', 'Region', 'Transit Gateway', 'Type'],
    colWidths: [150, 90, 80, 150, 70, 80],
    row: (a) => [a.id, tagName(a.tags), a.region.code, a.transitGatewayId, a.resourceType],
    recommend: (a) =>
      `Delete idle Transit Gateway attachment ${a.id} (${a.resourceType}) in ${a.region.code} — ${a.wasteReason}`,
  },
  'kinesis-provisioned-idle-stream': {
    title: 'Kinesis Streams — Idle (Provisioned mode, zero incoming records)',
    head: ['Stream Name', 'Region', 'Open Shards', 'Created'],
    colWidths: [150, 80, 70, 84, 80],
    row: (s) => [s.id, s.region.code, `${s.openShardCount}`, day(s.streamCreationTimestamp)],
    recommend: (s) =>
      `Delete or scale down idle Kinesis stream ${s.id} in ${s.region.code} — ${s.wasteReason}`,
  },
  'sqs-dlq-abandoned': {
    title: 'SQS Dead Letter Queues — Abandoned (hygiene, no direct cost)',
    head: ['Queue Name', 'Region', 'Messages', 'Oldest Message', 'Source Queue'],
    colWidths: [150, 70, 65, 80, 150, 80],
    row: (q) => [
      q.queueName,
      q.region.code,
      `${q.approximateNumberOfMessages}`,
      `${Math.floor(q.oldestMessageAgeSeconds / 86400)}d`,
      q.sourceQueueArn ?? 'unknown',
    ],
    recommend: (q) =>
      `Review DLQ ${q.queueName} in ${q.region.code} — ${q.wasteReason}`,
  },
  'lambda-loggroup-orphaned': {
    title: 'CloudWatch Log Groups — Orphaned Lambda (function no longer exists)',
    head: ['Log Group', 'Function (deleted)', 'Region', 'Stored', 'Last Event'],
    colWidths: [150, 130, 65, 70, 84, 80],
    row: (g) => [
      g.id,
      g.functionName,
      g.region.code,
      `${(g.storedBytes / 1024 ** 3).toFixed(1)} GB`,
      g.lastEventTimestamp ? day(g.lastEventTimestamp) : 'never',
    ],
    recommend: (g) =>
      `Delete orphaned log group ${g.id} in ${g.region.code} — ${g.wasteReason}`,
  },
  'aurora-serverless-overprovisioned': {
    title: 'Aurora Serverless v2 — Overprovisioned Min ACU (rightsizing candidate, verify before acting)',
    head: ['Cluster', 'Region', 'Engine', 'Min ACU', 'Peak ACU', 'Suggested Min'],
    colWidths: [130, 72, 100, 66, 68, 84, 80],
    row: (c) => [
      c.id,
      c.region.code,
      c.engine,
      `${c.minAcu}`,
      `${c.peakAcu.toFixed(2)}`,
      `${c.suggestedMinAcu}`,
    ],
    recommend: (c) =>
      `Lower Aurora Serverless v2 cluster ${c.id} (${c.engine}) in ${c.region.code} Min ACU ${c.minAcu}→${c.suggestedMinAcu} — peak ${c.peakAcu.toFixed(2)} ACU over ${c.windowHours}h (verify real workload peaks first)`,
  },
  'sagemaker-notebook-idle': {
    title: 'SageMaker Notebook Instances — Idle (checks CPU only, not Jupyter kernel activity)',
    head: ['Notebook', 'Region', 'Instance Type', 'Max CPU', 'Last Modified'],
    colWidths: [130, 72, 100, 66, 84, 80],
    row: (n) => [n.id, n.region.code, n.instanceType, `${n.maxCpuPercent.toFixed(1)}%`, day(n.lastModifiedTime)],
    recommend: (n) =>
      `Stop or delete idle SageMaker notebook ${n.id} (${n.instanceType}) in ${n.region.code} — max CPU ${n.maxCpuPercent.toFixed(1)}% over ${n.windowHours}h`,
  },
  'sagemaker-endpoint-idle': {
    title: 'SageMaker Endpoints — Idle (zero invocations)',
    head: ['Endpoint', 'Region', 'Instance Type', 'Count', 'Created'],
    colWidths: [130, 72, 100, 56, 84, 80],
    row: (e) => [e.id, e.region.code, e.instanceType, `${e.instanceCount}`, day(e.creationTime)],
    recommend: (e) =>
      `Delete idle SageMaker endpoint ${e.id} (${e.instanceCount}x ${e.instanceType}) in ${e.region.code} — zero invocations over ${e.windowHours}h`,
  },
  'sagemaker-training-orphaned': {
    title: 'SageMaker Models — Orphaned (not deployed to any endpoint, estimated storage cost)',
    head: ['Model', 'Region', 'Created', 'Model Data URL'],
    colWidths: [130, 72, 84, 200, 80],
    row: (m) => [m.id, m.region.code, day(m.creationTime), m.modelDataUrl],
    recommend: (m) =>
      `Delete orphaned SageMaker model ${m.id} in ${m.region.code} — not referenced by any endpoint config (verify it isn't a rollback/backup target first)`,
  },
  'environment-ghost': {
    title: 'Dev/PR Environments — Ghost (all evaluated resources inactive, hygiene, no direct cost)',
    head: ['Environment', 'Region', 'Method', 'Resources', 'Types', 'Last Activity'],
    colWidths: [130, 65, 75, 65, 130, 84, 90],
    row: (e) => [
      e.environmentName,
      e.region.code,
      e.detectionMethod,
      `${e.resourceCount}`,
      e.resourceTypes.join(', '),
      day(e.lastActivityTimestamp),
    ],
    recommend: (e) =>
      `Review ghost environment "${e.environmentName}" in ${e.region.code} — ${e.wasteReason} (verify before deleting)`,
  },
  'eks-node-overprovisioned': {
    title:
      'EKS Node Groups — Overprovisioned (rightsizing candidate, Container Insights node-level aggregate only, verify before acting)',
    head: ['Cluster / Node Group', 'Region', 'Instance Type', 'Nodes', 'CPU Requested', 'Suggested Nodes'],
    colWidths: [150, 72, 100, 50, 80, 80, 80],
    row: (n) => [
      n.id,
      n.region.code,
      n.instanceType,
      `${n.nodeCount}`,
      `${n.cpuRequestedPercent.toFixed(1)}%`,
      `${n.suggestedNodeCount}`,
    ],
    recommend: (n) =>
      `Scale EKS node group ${n.id} (${n.instanceType}) in ${n.region.code} ${n.nodeCount}→${n.suggestedNodeCount} nodes — CPU requested ${n.cpuRequestedPercent.toFixed(1)}% of allocatable over ${n.windowHours}h (Container Insights node-level aggregate, not individual Pod requests — verify real workload peaks first)`,
  },
  'eks-orphan-pvc': {
    title: 'EKS Orphaned PVC Volumes — Unattached or owning cluster deleted',
    head: ['Volume ID', 'PVC Name', 'Namespace', 'Cluster', 'Size', 'Type'],
    colWidths: [130, 100, 90, 110, 48, 48, 80],
    row: (v) => [
      v.id,
      v.pvcName,
      v.pvcNamespace,
      clusterDisplay(v.clusterName, v.clusterExists),
      `${v.sizeGb} GB`,
      v.volumeType,
    ],
    recommend: (v) =>
      `Delete orphaned Kubernetes PVC volume ${v.id} (${v.pvcNamespace}/${v.pvcName}) in ${v.region.code} — ${v.wasteReason}`,
  },
  'ami-unused': {
    title: 'AMIs — Unused (backing snapshots still billed)',
    head: ['Image ID', 'Name', 'Region', 'Snapshot Size', 'Created'],
    colWidths: [110, 130, 70, 70, 84, 80],
    row: (a) => [a.id, a.name, a.region.code, `${a.totalSnapshotSizeGb} GB`, day(a.creationDate)],
    recommend: (a) =>
      `Deregister unused AMI ${a.id} (${a.name}) in ${a.region.code} — ${a.wasteReason}`,
  },
  'ecr-image-untagged': {
    title: 'ECR Images — Untagged (dangling)',
    head: ['Digest', 'Repository', 'Region', 'Size', 'Pushed'],
    colWidths: [150, 130, 70, 60, 84, 80],
    row: (i) => [i.id, i.repositoryName, i.region.code, `${(i.sizeBytes / 1024 ** 3).toFixed(2)} GB`, day(i.imagePushedAt)],
    recommend: (i) =>
      `Delete untagged ECR image ${i.id} in repository ${i.repositoryName} (${i.region.code}) — ${i.wasteReason}`,
  },
  's3-multipart-upload-abandoned': {
    title: 'S3 Multipart Uploads — Abandoned (never completed or aborted)',
    head: ['Upload ID', 'Bucket', 'Key', 'Region', 'Uploaded', 'Initiated'],
    colWidths: [130, 110, 130, 65, 70, 84, 80],
    row: (u) => [u.id, u.bucketName, u.key, u.region.code, `${(u.uploadedBytes / 1024 ** 3).toFixed(2)} GB`, day(u.initiated)],
    recommend: (u) =>
      `Abort incomplete multipart upload ${u.id} for ${u.bucketName}/${u.key} in ${u.region.code} — ${u.wasteReason}`,
  },
  'rds-manual-snapshot-old': {
    title: 'RDS Manual Snapshots — Old',
    head: ['Snapshot ID', 'Source DB', 'Region', 'Engine', 'Storage', 'Created'],
    colWidths: [130, 110, 70, 68, 60, 84, 80],
    row: (s) => [
      s.id,
      s.sourceDbInstanceId,
      s.region.code,
      s.engine,
      `${s.allocatedStorageGb} GB`,
      day(s.snapshotCreateTime),
    ],
    recommend: (s) =>
      `Delete old manual RDS snapshot ${s.id} (${s.allocatedStorageGb} GB) in ${s.region.code} — ${s.wasteReason}`,
  },
  'secretsmanager-unused': {
    title: 'Secrets Manager Secrets — Unused',
    head: ['Name', 'Region', 'Created', 'Last Accessed'],
    colWidths: [180, 80, 90, 84, 85],
    row: (s) => [s.name, s.region.code, day(s.createdDate), s.lastAccessedDate ? day(s.lastAccessedDate) : 'never'],
    recommend: (s) =>
      `Delete unused Secrets Manager secret "${s.name}" in ${s.region.code} — ${s.wasteReason}`,
  },
};

/**
 * Metadata-only accessor (title/head/colWidths) — safe to erase to the
 * default `ResourcePresenter<WastedResource>` because none of these fields
 * depend on the specific entity type. Never call `.row()`/`.recommend()` on
 * what this returns; use `rowFor`/`recommendFor` below for that.
 */
export function presenterFor(kind: ResourceKind): Omit<ResourcePresenter, 'row' | 'recommend'> {
  return presenters[kind];
}

/**
 * Union of every concrete entity type, discriminated by `kind` — the type
 * `rowFor`/`recommendFor` below switch on. Get a value of this type via
 * `groupByKind()` (`grouped[kind]`, for any `kind`, even the widened loop
 * variable from `for (const kind of RESOURCE_KINDS)`): TypeScript preserves
 * the kind↔entity correlation through that indexing, just not through
 * `presenters[kind]` typed as the flat `ResourceKind` parameter it used to be.
 */
type AnyResourceEntity = ResourceKindMap[ResourceKind];

/**
 * Dispatches `finding` to its presenter's `row`/`recommend` via an exhaustive
 * switch on `finding.kind`. Unlike the old `presenterFor(kind).row(finding)`
 * pattern, this cannot be called with a mismatched (kind, finding) pair — the
 * kind IS the finding's own, so there is nothing to decouple. Compiler
 * enforced: `noImplicitReturns` (tsconfig.base.json) fails the build if a
 * kind is left unhandled, and `noFallthroughCasesInSwitch` blocks accidental
 * fallthrough between the cases (one per `ResourceKind`, see `RESOURCE_KINDS`).
 *
 * Tried a generic `presenterFor<K extends ResourceKind>(kind: K): ResourcePresenter<ResourceKindMap[K]>`
 * first: it does not work, because every real call site derives `kind` from
 * a loop or `finding.kind` — never a literal — so the compiler always infers
 * `K` as the full union again, silently defeating the correlation (verified
 * experimentally with a deliberately-decoupled repro before writing this).
 */
export function rowFor(finding: AnyResourceEntity): string[] {
  switch (finding.kind) {
    case 'ebs-volume': return presenters['ebs-volume'].row(finding);
    case 'elastic-ip': return presenters['elastic-ip'].row(finding);
    case 'rds-instance': return presenters['rds-instance'].row(finding);
    case 'load-balancer': return presenters['load-balancer'].row(finding);
    case 'ec2-instance': return presenters['ec2-instance'].row(finding);
    case 'ebs-snapshot': return presenters['ebs-snapshot'].row(finding);
    case 'nat-gateway': return presenters['nat-gateway'].row(finding);
    case 'ebs-gp2-upgrade': return presenters['ebs-gp2-upgrade'].row(finding);
    case 'ebs-idle': return presenters['ebs-idle'].row(finding);
    case 'ec2-underutilized': return presenters['ec2-underutilized'].row(finding);
    case 'rds-underutilized': return presenters['rds-underutilized'].row(finding);
    case 'log-group': return presenters['log-group'].row(finding);
    case 'eni-orphaned': return presenters['eni-orphaned'].row(finding);
    case 's3-no-lifecycle': return presenters['s3-no-lifecycle'].row(finding);
    case 'lambda-underutilized': return presenters['lambda-underutilized'].row(finding);
    case 'efs-unused': return presenters['efs-unused'].row(finding);
    case 'dynamodb-overprovisioned': return presenters['dynamodb-overprovisioned'].row(finding);
    case 'elasticache-idle': return presenters['elasticache-idle'].row(finding);
    case 'redshift-idle-cluster': return presenters['redshift-idle-cluster'].row(finding);
    case 'opensearch-idle-domain': return presenters['opensearch-idle-domain'].row(finding);
    case 'msk-idle-cluster': return presenters['msk-idle-cluster'].row(finding);
    case 'fsx-idle-filesystem': return presenters['fsx-idle-filesystem'].row(finding);
    case 'documentdb-idle-instance': return presenters['documentdb-idle-instance'].row(finding);
    case 'neptune-idle-instance': return presenters['neptune-idle-instance'].row(finding);
    case 'mq-idle-broker': return presenters['mq-idle-broker'].row(finding);
    case 'workspaces-idle': return presenters['workspaces-idle'].row(finding);
    case 'vpn-connection-idle': return presenters['vpn-connection-idle'].row(finding);
    case 'transit-gateway-idle-attachment': return presenters['transit-gateway-idle-attachment'].row(finding);
    case 'kinesis-provisioned-idle-stream': return presenters['kinesis-provisioned-idle-stream'].row(finding);
    case 'sqs-dlq-abandoned': return presenters['sqs-dlq-abandoned'].row(finding);
    case 'lambda-loggroup-orphaned': return presenters['lambda-loggroup-orphaned'].row(finding);
    case 'aurora-serverless-overprovisioned': return presenters['aurora-serverless-overprovisioned'].row(finding);
    case 'sagemaker-notebook-idle': return presenters['sagemaker-notebook-idle'].row(finding);
    case 'sagemaker-endpoint-idle': return presenters['sagemaker-endpoint-idle'].row(finding);
    case 'sagemaker-training-orphaned': return presenters['sagemaker-training-orphaned'].row(finding);
    case 'environment-ghost': return presenters['environment-ghost'].row(finding);
    case 'eks-node-overprovisioned': return presenters['eks-node-overprovisioned'].row(finding);
    case 'eks-orphan-pvc': return presenters['eks-orphan-pvc'].row(finding);
    case 'ami-unused': return presenters['ami-unused'].row(finding);
    case 'ecr-image-untagged': return presenters['ecr-image-untagged'].row(finding);
    case 's3-multipart-upload-abandoned': return presenters['s3-multipart-upload-abandoned'].row(finding);
    case 'rds-manual-snapshot-old': return presenters['rds-manual-snapshot-old'].row(finding);
    case 'secretsmanager-unused': return presenters['secretsmanager-unused'].row(finding);
  }
}

/** See `rowFor` above — same dispatch, `recommend` instead of `row`. */
export function recommendFor(finding: AnyResourceEntity): string {
  switch (finding.kind) {
    case 'ebs-volume': return presenters['ebs-volume'].recommend(finding);
    case 'elastic-ip': return presenters['elastic-ip'].recommend(finding);
    case 'rds-instance': return presenters['rds-instance'].recommend(finding);
    case 'load-balancer': return presenters['load-balancer'].recommend(finding);
    case 'ec2-instance': return presenters['ec2-instance'].recommend(finding);
    case 'ebs-snapshot': return presenters['ebs-snapshot'].recommend(finding);
    case 'nat-gateway': return presenters['nat-gateway'].recommend(finding);
    case 'ebs-gp2-upgrade': return presenters['ebs-gp2-upgrade'].recommend(finding);
    case 'ebs-idle': return presenters['ebs-idle'].recommend(finding);
    case 'ec2-underutilized': return presenters['ec2-underutilized'].recommend(finding);
    case 'rds-underutilized': return presenters['rds-underutilized'].recommend(finding);
    case 'log-group': return presenters['log-group'].recommend(finding);
    case 'eni-orphaned': return presenters['eni-orphaned'].recommend(finding);
    case 's3-no-lifecycle': return presenters['s3-no-lifecycle'].recommend(finding);
    case 'lambda-underutilized': return presenters['lambda-underutilized'].recommend(finding);
    case 'efs-unused': return presenters['efs-unused'].recommend(finding);
    case 'dynamodb-overprovisioned': return presenters['dynamodb-overprovisioned'].recommend(finding);
    case 'elasticache-idle': return presenters['elasticache-idle'].recommend(finding);
    case 'redshift-idle-cluster': return presenters['redshift-idle-cluster'].recommend(finding);
    case 'opensearch-idle-domain': return presenters['opensearch-idle-domain'].recommend(finding);
    case 'msk-idle-cluster': return presenters['msk-idle-cluster'].recommend(finding);
    case 'fsx-idle-filesystem': return presenters['fsx-idle-filesystem'].recommend(finding);
    case 'documentdb-idle-instance': return presenters['documentdb-idle-instance'].recommend(finding);
    case 'neptune-idle-instance': return presenters['neptune-idle-instance'].recommend(finding);
    case 'mq-idle-broker': return presenters['mq-idle-broker'].recommend(finding);
    case 'workspaces-idle': return presenters['workspaces-idle'].recommend(finding);
    case 'vpn-connection-idle': return presenters['vpn-connection-idle'].recommend(finding);
    case 'transit-gateway-idle-attachment': return presenters['transit-gateway-idle-attachment'].recommend(finding);
    case 'kinesis-provisioned-idle-stream': return presenters['kinesis-provisioned-idle-stream'].recommend(finding);
    case 'sqs-dlq-abandoned': return presenters['sqs-dlq-abandoned'].recommend(finding);
    case 'lambda-loggroup-orphaned': return presenters['lambda-loggroup-orphaned'].recommend(finding);
    case 'aurora-serverless-overprovisioned': return presenters['aurora-serverless-overprovisioned'].recommend(finding);
    case 'sagemaker-notebook-idle': return presenters['sagemaker-notebook-idle'].recommend(finding);
    case 'sagemaker-endpoint-idle': return presenters['sagemaker-endpoint-idle'].recommend(finding);
    case 'sagemaker-training-orphaned': return presenters['sagemaker-training-orphaned'].recommend(finding);
    case 'environment-ghost': return presenters['environment-ghost'].recommend(finding);
    case 'eks-node-overprovisioned': return presenters['eks-node-overprovisioned'].recommend(finding);
    case 'eks-orphan-pvc': return presenters['eks-orphan-pvc'].recommend(finding);
    case 'ami-unused': return presenters['ami-unused'].recommend(finding);
    case 'ecr-image-untagged': return presenters['ecr-image-untagged'].recommend(finding);
    case 's3-multipart-upload-abandoned': return presenters['s3-multipart-upload-abandoned'].recommend(finding);
    case 'rds-manual-snapshot-old': return presenters['rds-manual-snapshot-old'].recommend(finding);
    case 'secretsmanager-unused': return presenters['secretsmanager-unused'].recommend(finding);
  }
}
