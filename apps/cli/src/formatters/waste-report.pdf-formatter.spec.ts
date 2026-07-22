// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AwsRegion,
  RESOURCE_KIND_META,
  EbsVolume,
  ElasticIp,
  RdsInstance,
  LoadBalancer,
  Ec2Instance,
  EbsSnapshot,
  NatGateway,
  Gp2Volume,
  IdleEbsVolume,
  UnderutilizedEc2Instance,
  RdsUnderutilizedInstance,
  LogGroup,
  OrphanedEni,
  S3Bucket,
  UnderutilizedLambdaFunction,
  EfsFileSystem,
  OverprovisionedDynamoDbTable,
  IdleElastiCacheCluster,
  RedshiftCluster,
  OpenSearchDomain,
  MskCluster,
  FsxFileSystem,
  DocumentDbInstance,
  NeptuneInstance,
  MqBroker,
  Workspace,
  VpnConnection,
  TransitGatewayAttachment,
  KinesisStream,
} from 'cloud-cost-domain';
import type { WastedResource, WastedResourcesSummary } from 'cloud-cost-domain';
import type { WasteReportMeta } from 'cloud-cost-application';
import { generateWasteReportPdf } from './waste-report.pdf-formatter';

const region = AwsRegion.create('us-east-1');
const accountId = '123456789012';
const now = new Date('2026-07-10T10:00:00Z');
const OLD = new Date('2024-01-01T00:00:00Z');
const tags = {};

const meta: WasteReportMeta = {
  accountId,
  regions: ['us-east-1', 'eu-west-1'],
  generatedAt: now,
  pricesAsOf: '2026-06',
};

/**
 * One finding per resource kind (plus two extra in the busiest kinds, to also
 * exercise multi-row wrapping within a section) so every presenter's row/
 * recommend logic runs at least once. Regression guard for point #3 of
 * docs/code-review-2026-07-10.md: an unsafe `finding as X` cast in a
 * presenter throws here instead of only the first time a real scan produces
 * that exact kind.
 */
function allKindFindings(): WastedResource[] {
  return [
    new EbsVolume({ volumeId: 'vol-1', region, accountId, sizeGb: 100, volumeType: 'gp3', state: 'available', createTime: OLD, detectedAt: now, tags, monthlyCostUsd: 8 }),
    new EbsVolume({ volumeId: 'vol-2', region, accountId, sizeGb: 500, volumeType: 'io1', state: 'available', createTime: OLD, detectedAt: now, tags, monthlyCostUsd: 40 }),
    new ElasticIp({ allocationId: 'eipalloc-1', publicIp: '1.2.3.4', region, accountId, detectedAt: now, tags, monthlyCostUsd: 3.6 }),
    new RdsInstance({ dbInstanceIdentifier: 'db-1', region, accountId, dbInstanceClass: 'db.t3.micro', engine: 'postgres', dbInstanceStatus: 'stopped', allocatedStorageGb: 20, storageType: 'gp3', multiAZ: false, detectedAt: now, tags, monthlyCostUsd: 15 }),
    new LoadBalancer({ arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/lb-1/abc', name: 'lb-1', region, accountId, type: 'application', createdTime: OLD, detectedAt: now, registeredTargetCount: 0, tags, monthlyCostUsd: 16 }),
    new Ec2Instance({ instanceId: 'i-1', region, accountId, instanceType: 't3.micro', state: 'stopped', launchTime: OLD, detectedAt: now, stoppedSince: OLD, attachedVolumes: [{ volumeId: 'vol-3', sizeGb: 8, volumeType: 'gp3' }], tags, monthlyCostUsd: 0.64 }),
    new EbsSnapshot({ snapshotId: 'snap-1', region, accountId, sourceVolumeId: 'vol-gone', sourceVolumeExists: false, sizeGb: 100, startTime: OLD, detectedAt: now, description: 'old snapshot', tags, monthlyCostUsd: 5 }),
    new EbsSnapshot({ snapshotId: 'snap-2', region, accountId, sourceVolumeId: 'vol-gone-2', sourceVolumeExists: false, sizeGb: 50, startTime: OLD, detectedAt: now, description: 'another old snapshot', tags, monthlyCostUsd: 2.5 }),
    new NatGateway({ natGatewayId: 'nat-1', region, accountId, vpcId: 'vpc-1', createTime: OLD, detectedAt: now, bytesOutLastWindow: 0, metricWindowHours: 168, tags, monthlyCostUsd: 32 }),
    new Gp2Volume({ volumeId: 'vol-4', region, accountId, sizeGb: 200, createTime: OLD, detectedAt: now, tags, monthlyCostUsd: 4 }),
    new IdleEbsVolume({ volumeId: 'vol-5', region, accountId, sizeGb: 100, volumeType: 'gp3', attachedInstanceId: 'i-2', readOps: 0, writeOps: 0, metricWindowHours: 168, createTime: OLD, detectedAt: now, tags, monthlyCostUsd: 8 }),
    new UnderutilizedEc2Instance({ instanceId: 'i-3', region, accountId, instanceType: 'm5.large', avgCpuPercent: 1.2, maxCpuPercent: 3.4, windowDays: 14, launchTime: OLD, detectedAt: now, tags, monthlyCostUsd: 70 }),
    new RdsUnderutilizedInstance({ dbInstanceIdentifier: 'db-2', region, accountId, dbInstanceClass: 'db.m5.large', engine: 'mysql', avgCpuPercent: 2, maxCpuPercent: 5, windowDays: 14, instanceCreateTime: OLD, detectedAt: now, tags, monthlyCostUsd: 120 }),
    new LogGroup({ logGroupName: '/aws/lambda/my-fn', region, accountId, storedBytes: 1024 ** 3, creationTime: OLD, detectedAt: now, tags, monthlyCostUsd: 0.03 }),
    new OrphanedEni({ networkInterfaceId: 'eni-1', region, accountId, vpcId: 'vpc-1', subnetId: 'subnet-1', status: 'available', detectedAt: now, tags }),
    new S3Bucket({ bucketName: 'my-bucket', region, accountId, sizeBytes: 1024 ** 4, hasLifecyclePolicy: false, creationDate: OLD, detectedAt: now, tags, monthlyCostUsd: 1.5 }),
    new UnderutilizedLambdaFunction({ functionName: 'my-fn', region, accountId, memorySizeMb: 512, invocationsLastWindow: 0, windowDays: 30, lastModified: OLD, detectedAt: now, tags }),
    new EfsFileSystem({ fileSystemId: 'fs-1', region, accountId, sizeBytes: 1024 ** 3, numberOfMountTargets: 0, ioBytesLastWindow: 0, metricWindowHours: 168, creationTime: OLD, detectedAt: now, tags, monthlyCostUsd: 0.3 }),
    new OverprovisionedDynamoDbTable({ tableName: 'my-table', region, accountId, readCapacityUnits: 100, writeCapacityUnits: 100, consumedReadCapacityUnits: 1, consumedWriteCapacityUnits: 1, windowDays: 14, creationDateTime: OLD, detectedAt: now, tags, monthlyCostUsd: 45 }),
    new IdleElastiCacheCluster({ cacheClusterId: 'cache-1', region, accountId, cacheNodeType: 'cache.t3.micro', numCacheNodes: 1, connectionsLastWindow: 0, metricWindowHours: 168, createTime: OLD, detectedAt: now, tags, monthlyCostUsd: 12 }),
    new RedshiftCluster({ clusterIdentifier: 'cluster-1', region, accountId, nodeType: 'dc2.large', numberOfNodes: 1, connectionsLastWindow: 0, metricWindowHours: 168, clusterCreateTime: OLD, detectedAt: now, tags, monthlyCostUsd: 180 }),
    new OpenSearchDomain({ domainName: 'my-domain', region, accountId, instanceType: 't3.small.search', instanceCount: 1, requestsLastWindow: 0, metricWindowHours: 168, detectedAt: now, tags, monthlyCostUsd: 25 }),
    new MskCluster({ clusterName: 'my-cluster', region, accountId, brokerInstanceType: 'kafka.t3.small', numberOfBrokerNodes: 2, bytesLastWindow: 0, metricWindowHours: 168, creationTime: OLD, detectedAt: now, tags, monthlyCostUsd: 90 }),
    new FsxFileSystem({ fileSystemId: 'fsx-1', region, accountId, fileSystemType: 'WINDOWS', storageCapacityGiB: 100, ioBytesLastWindow: 0, metricWindowHours: 168, creationTime: OLD, detectedAt: now, tags, monthlyCostUsd: 15 }),
    new DocumentDbInstance({ dbInstanceIdentifier: 'docdb-1', region, accountId, dbInstanceClass: 'db.t3.medium', connectionsLastWindow: 0, metricWindowHours: 168, instanceCreateTime: OLD, detectedAt: now, tags, monthlyCostUsd: 60 }),
    new NeptuneInstance({ dbInstanceIdentifier: 'neptune-1', region, accountId, dbInstanceClass: 'db.t3.medium', requestsLastWindow: 0, metricWindowHours: 168, instanceCreateTime: OLD, detectedAt: now, tags, monthlyCostUsd: 65 }),
    new MqBroker({ brokerId: 'broker-1', brokerName: 'my-broker', region, accountId, hostInstanceType: 'mq.t3.micro', deploymentMode: 'SINGLE_INSTANCE', networkBytesLastWindow: 0, metricWindowHours: 168, created: OLD, detectedAt: now, tags, monthlyCostUsd: 10 }),
    new Workspace({ workspaceId: 'ws-1', region, accountId, userName: 'jdoe', computeTypeName: 'STANDARD', runningMode: 'ALWAYS_ON', lastKnownUserConnectionTimestamp: undefined, detectedAt: now, tags, monthlyCostUsd: 35 }),
    new VpnConnection({ vpnConnectionId: 'vpn-1', region, accountId, vpnGatewayId: 'vgw-1', transitGatewayId: undefined, tunnelBytesLastWindow: 0, metricWindowHours: 168, detectedAt: now, tags, monthlyCostUsd: 5 }),
    new TransitGatewayAttachment({ transitGatewayAttachmentId: 'tgw-attach-1', region, accountId, transitGatewayId: 'tgw-1', resourceType: 'vpc', bytesLastWindow: 0, metricWindowHours: 168, creationTime: OLD, detectedAt: now, tags, monthlyCostUsd: 8 }),
    new KinesisStream({ streamName: 'my-stream', region, accountId, openShardCount: 2, incomingActivityLastWindow: 0, metricWindowHours: 168, streamCreationTimestamp: OLD, detectedAt: now, tags, monthlyCostUsd: 30 }),
  ];
}

describe('generateWasteReportPdf', () => {
  it('completes without throwing for a realistic summary covering every resource kind', async () => {
    const findings = allKindFindings();
    const summary: WastedResourcesSummary = {
      findings,
      totalWasteMonthlyUsd: findings
        .filter((f) => RESOURCE_KIND_META[f.kind].category === 'waste')
        .reduce((sum, f) => sum + f.costEstimate.monthlyCostUsd, 0),
      totalOptimizationMonthlyUsd: findings
        .filter((f) => RESOURCE_KIND_META[f.kind].category === 'optimization')
        .reduce((sum, f) => sum + f.costEstimate.monthlyCostUsd, 0),
      scanErrors: [
        {
          kind: 'redshift-idle-cluster',
          region: 'eu-west-1',
          error: new Error(
            'AccessDenied: User is not authorized to perform redshift:DescribeClusters on this resource because no identity-based policy allows it',
          ),
        },
      ],
    };

    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'report.pdf');
    try {
      await expect(generateWasteReportPdf(summary, meta, file)).resolves.toBeUndefined();

      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(written.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes without throwing for the empty case (no findings, no errors)', async () => {
    const summary: WastedResourcesSummary = {
      findings: [],
      totalWasteMonthlyUsd: 0,
      totalOptimizationMonthlyUsd: 0,
      scanErrors: [],
    };

    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-pdf-'));
    const file = join(dir, 'empty.pdf');
    try {
      await expect(generateWasteReportPdf(summary, meta, file)).resolves.toBeUndefined();
      const written = await readFile(file);
      expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
