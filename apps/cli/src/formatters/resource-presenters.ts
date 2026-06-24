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

type PresenterMap = { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> };

export const presenters: PresenterMap = {
  'ebs-volume': {
    title: 'EBS Volumes — Unattached',
    head: ['Volume ID', 'Region', 'Size', 'Type', 'Created'],
    colWidths: [135, 80, 48, 48, 84, 80],
    row: (v) => [v.id, v.region.code, `${v.sizeGb} GB`, v.volumeType, day(v.createTime)],
    recommend: (v) =>
      `Delete unattached EBS ${v.id} — ${v.sizeGb} GB ${v.volumeType} in ${v.region.code}`,
  },
  'elastic-ip': {
    title: 'Elastic IPs — Unassociated',
    head: ['Allocation ID', 'Region', 'Public IP'],
    colWidths: [175, 84, 156, 80],
    row: (ip) => [ip.id, ip.region.code, ip.publicIp],
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
    head: ['Instance ID', 'Region', 'Type', 'Volumes', 'Stopped since'],
    colWidths: [110, 72, 62, 115, 80, 56],
    row: (inst) => [
      inst.id,
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
    head: ['Snapshot ID', 'Region', 'Source Volume', 'Size', 'Created'],
    colWidths: [115, 72, 112, 48, 80, 68],
    row: (snap) => [
      snap.id,
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
    head: ['NAT Gateway ID', 'Region', 'VPC', 'Created'],
    colWidths: [130, 70, 140, 80, 75],
    row: (gw) => [gw.id, gw.region.code, gw.vpcId, day(gw.createTime)],
    recommend: (gw) =>
      `Delete idle NAT Gateway ${gw.id} in ${gw.region.code} — ${gw.wasteReason}`,
  },
  'ebs-gp2-upgrade': {
    title: 'EBS Volumes — gp2→gp3 upgrade (savings opportunity, not deletable waste)',
    head: ['Volume ID', 'Region', 'Size', 'Created'],
    colWidths: [170, 90, 60, 96, 80],
    row: (v) => [v.id, v.region.code, `${v.sizeGb} GB`, day(v.createTime)],
    recommend: (v) =>
      `Modify EBS ${v.id} (${v.sizeGb} GB gp2) in ${v.region.code} to gp3 — saves ${v.costEstimate.format()}, no downtime`,
  },
  'ebs-idle': {
    title: 'EBS Volumes — Idle (attached, no I/O)',
    head: ['Volume ID', 'Region', 'Size', 'Type', 'Attached to'],
    colWidths: [130, 72, 56, 50, 130, 70],
    row: (v) => [
      v.id,
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
    head: ['Instance ID', 'Region', 'Type', 'Avg CPU', 'Max CPU', 'Window'],
    colWidths: [110, 72, 70, 70, 70, 60, 80],
    row: (inst) => [
      inst.id,
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
    head: ['Network Interface ID', 'Region', 'VPC', 'Subnet'],
    // Subnet IDs ("subnet-...") are the longest of the four ID-like values
    // here (24 chars vs. 21 for eni-/vpc-), so they need the widest column —
    // it was previously tied with VPC while Network Interface ID (also 21
    // chars) was overallocated, clipping the subnet column.
    colWidths: [115, 65, 110, 140, 65],
    row: (eni) => [eni.id, eni.region.code, eni.vpcId, eni.subnetId],
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
    head: ['File System ID', 'Region', 'Size', 'Mount Targets'],
    colWidths: [140, 80, 70, 100, 80],
    row: (fs) => [
      fs.id,
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
};

export function presenterFor(kind: ResourceKind): ResourcePresenter {
  return presenters[kind] as ResourcePresenter;
}
