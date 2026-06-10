import Table from 'cli-table3';
import chalk from 'chalk';
import type { WastedResourcesSummary } from 'cloud-cost-domain';

export function formatWasteReportAsTable(
  summary: WastedResourcesSummary,
): string {
  const lines: string[] = [];

  if (summary.ebsVolumes.length > 0) {
    lines.push(chalk.bold.yellow('\n  EBS Volumes — Unattached'));

    const ebsTable = new Table({
      head: ['Volume ID', 'Region', 'Size', 'Type', 'Created', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const vol of summary.ebsVolumes) {
      ebsTable.push([
        vol.id,
        vol.region.code,
        `${vol.sizeGb} GB`,
        vol.volumeType,
        vol.createTime.toISOString().split('T')[0],
        chalk.red(vol.costEstimate.format()),
      ]);
    }
    lines.push(ebsTable.toString());
  }

  if (summary.elasticIps.length > 0) {
    lines.push(chalk.bold.yellow('\n  Elastic IPs — Unassociated'));

    const eipTable = new Table({
      head: ['Allocation ID', 'Region', 'Public IP', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const ip of summary.elasticIps) {
      eipTable.push([
        ip.id,
        ip.region.code,
        ip.publicIp,
        chalk.red(ip.costEstimate.format()),
      ]);
    }
    lines.push(eipTable.toString());
  }

  if (summary.rdsInstances.length > 0) {
    lines.push(chalk.bold.yellow('\n  RDS Instances — Stopped'));

    const rdsTable = new Table({
      head: ['Identifier', 'Region', 'Class', 'Engine', 'Storage', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const db of summary.rdsInstances) {
      rdsTable.push([
        db.id,
        db.region.code,
        db.dbInstanceClass,
        db.engine,
        `${db.allocatedStorageGb} GB ${db.storageType}`,
        chalk.red(db.costEstimate.format()),
      ]);
    }
    lines.push(rdsTable.toString());
  }

  if (summary.loadBalancers.length > 0) {
    lines.push(chalk.bold.yellow('\n  Load Balancers — Idle (no registered targets)'));

    const elbTable = new Table({
      head: ['Name', 'Region', 'Type', 'Created', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const lb of summary.loadBalancers) {
      elbTable.push([
        lb.name,
        lb.region.code,
        lb.type,
        lb.createdTime.toISOString().split('T')[0],
        chalk.red(lb.costEstimate.format()),
      ]);
    }
    lines.push(elbTable.toString());
  }

  if (summary.stoppedEc2Instances.length > 0) {
    lines.push(chalk.bold.yellow('\n  EC2 Instances — Stopped (EBS still billed)'));

    const ec2Table = new Table({
      head: ['Instance ID', 'Region', 'Type', 'Volumes', 'Launched', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const inst of summary.stoppedEc2Instances) {
      const volSummary =
        inst.attachedVolumes.length === 0
          ? 'none'
          : inst.attachedVolumes.map((v) => `${v.sizeGb}GB ${v.volumeType}`).join(', ');
      ec2Table.push([
        inst.id,
        inst.region.code,
        inst.instanceType,
        volSummary,
        inst.launchTime.toISOString().split('T')[0],
        chalk.red(inst.costEstimate.format()),
      ]);
    }
    lines.push(ec2Table.toString());
  }

  if (summary.orphanSnapshots.length > 0) {
    lines.push(chalk.bold.yellow('\n  EBS Snapshots — Orphaned (source volume deleted)'));

    const snapTable = new Table({
      head: ['Snapshot ID', 'Region', 'Source Volume', 'Size', 'Created', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const snap of summary.orphanSnapshots) {
      snapTable.push([
        snap.id,
        snap.region.code,
        snap.sourceVolumeId,
        `${snap.sizeGb} GB`,
        snap.startTime.toISOString().split('T')[0],
        chalk.red(snap.costEstimate.format()),
      ]);
    }
    lines.push(snapTable.toString());
  }

  if (summary.idleNatGateways.length > 0) {
    lines.push(chalk.bold.yellow('\n  NAT Gateways — Idle (0 traffic in last 48h)'));

    const natTable = new Table({
      head: ['NAT Gateway ID', 'Region', 'VPC', 'Created', 'Est. Cost'],
      style: { head: ['cyan'] },
    });

    for (const gw of summary.idleNatGateways) {
      natTable.push([
        gw.id,
        gw.region.code,
        gw.vpcId,
        gw.createTime.toISOString().split('T')[0],
        chalk.red(gw.costEstimate.format()),
      ]);
    }
    lines.push(natTable.toString());
  }

  if (
    summary.ebsVolumes.length === 0 &&
    summary.elasticIps.length === 0 &&
    summary.rdsInstances.length === 0 &&
    summary.loadBalancers.length === 0 &&
    summary.stoppedEc2Instances.length === 0 &&
    summary.orphanSnapshots.length === 0 &&
    summary.idleNatGateways.length === 0 &&
    summary.scanErrors.length === 0
  ) {
    lines.push(chalk.green('\n  No wasted resources found.'));
  }

  if (summary.scanErrors.length > 0) {
    lines.push(chalk.bold.yellow('\n  Scan warnings — partial results (some resource types could not be scanned):'));
    for (const { resourceType, error } of summary.scanErrors) {
      lines.push(chalk.yellow(`    • ${resourceType}: ${error.message}`));
    }
  }

  lines.push(
    chalk.bold(
      `\n  Total estimated waste: ${chalk.red(`$${summary.totalMonthlyCostUsd.toFixed(2)}/month`)}${summary.scanErrors.length > 0 ? chalk.yellow(' (incomplete — see warnings above)') : ''}\n`,
    ),
  );

  return lines.join('\n');
}
