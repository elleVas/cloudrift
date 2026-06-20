import type { ResourceKind, ResourceKindMap, WastedResource } from 'cloud-cost-domain';

/**
 * Presentazione per tipo di risorsa, condivisa da formatter console e PDF.
 * Aggiungere un nuovo ResourceKind obbliga (via compilatore) ad aggiungere
 * qui il relativo presenter — unico punto di modifica lato CLI.
 */
export interface ResourcePresenter<T extends WastedResource = WastedResource> {
  title: string;
  /** Intestazioni colonne, costo escluso (aggiunto dai formatter come ultima colonna). */
  head: string[];
  /** Larghezze colonne PDF; l'ultimo elemento è la colonna costo. */
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
};

export function presenterFor(kind: ResourceKind): ResourcePresenter {
  return presenters[kind] as ResourcePresenter;
}
