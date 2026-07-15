// SPDX-License-Identifier: Apache-2.0
//
// Contract tests (REVIEW.md #10): replays realistic raw AWS responses —
// captured once from LocalStack by scripts/capture-contract-fixtures.mjs, or
// transcribed from the AWS API reference for the kinds LocalStack Community
// can't host — through each scanner's full pipeline (list → narrow → metric →
// toEntity → policy) and asserts the exact findings the live run produced.
// Unlike the per-scanner specs (which auto-mock the SDK modules and build
// minimal payloads by hand), the Command classes here are real and the pages
// carry the full response shape, `$metadata`, pagination cursors and all; the
// only seam is the SDK's shared Client base class `send`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EC2Client } from '@aws-sdk/client-ec2';
import {
  AwsRegion,
  RESOURCE_KINDS,
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
  SageMakerNotebookIdlePolicy,
  SageMakerEndpointIdlePolicy,
  SageMakerTrainingOrphanedPolicy,
  EnvironmentGhostPolicy,
} from 'cloud-cost-domain';
import type { ResourceKind, WasteScannerPort } from 'cloud-cost-domain';
import { AwsEbsVolumeScanner } from './aws-ebs-volume.scanner';
import { AwsElasticIpScanner } from './aws-elastic-ip.scanner';
import { AwsRdsInstanceScanner } from './aws-rds-instance.scanner';
import { AwsLoadBalancerScanner } from './aws-load-balancer.scanner';
import { AwsEc2InstanceScanner } from './aws-ec2-instance.scanner';
import { AwsEbsSnapshotScanner } from './aws-ebs-snapshot.scanner';
import { AwsNatGatewayScanner } from './aws-nat-gateway.scanner';
import { AwsGp2UpgradeScanner } from './aws-gp2-upgrade.scanner';
import { AwsEbsIdleScanner } from './aws-ebs-idle.scanner';
import { AwsEc2UnderutilizedScanner } from './aws-ec2-underutilized.scanner';
import { AwsRdsUnderutilizedScanner } from './aws-rds-underutilized.scanner';
import { AwsLogGroupScanner } from './aws-log-group.scanner';
import { AwsEniOrphanedScanner } from './aws-eni-orphaned.scanner';
import { AwsS3NoLifecycleScanner } from './aws-s3-no-lifecycle.scanner';
import { AwsLambdaUnderutilizedScanner } from './aws-lambda-underutilized.scanner';
import { AwsEfsUnusedScanner } from './aws-efs-unused.scanner';
import { AwsDynamoDbOverprovisionedScanner } from './aws-dynamodb-overprovisioned.scanner';
import { AwsElastiCacheIdleScanner } from './aws-elasticache-idle.scanner';
import { AwsRedshiftIdleScanner } from './aws-redshift-idle.scanner';
import { AwsOpenSearchIdleScanner } from './aws-opensearch-idle.scanner';
import { AwsMskIdleScanner } from './aws-msk-idle.scanner';
import { AwsFsxIdleScanner } from './aws-fsx-idle.scanner';
import { AwsDocumentDbIdleScanner } from './aws-documentdb-idle.scanner';
import { AwsNeptuneIdleScanner } from './aws-neptune-idle.scanner';
import { AwsMqIdleScanner } from './aws-mq-idle.scanner';
import { AwsWorkspacesIdleScanner } from './aws-workspaces-idle.scanner';
import { AwsVpnConnectionIdleScanner } from './aws-vpn-connection-idle.scanner';
import { AwsTransitGatewayIdleScanner } from './aws-transit-gateway-idle.scanner';
import { AwsKinesisIdleScanner } from './aws-kinesis-idle.scanner';
import { AwsSqsDlqAbandonedScanner } from './aws-sqs-dlq-abandoned.scanner';
import { AwsLambdaLogGroupOrphanedScanner } from './aws-lambda-loggroup-orphaned.scanner';
import { AwsAuroraServerlessIdleScanner } from './aws-aurora-serverless-idle.scanner';
import { AwsSageMakerNotebookIdleScanner } from './aws-sagemaker-notebook-idle.scanner';
import { AwsSageMakerEndpointIdleScanner } from './aws-sagemaker-endpoint-idle.scanner';
import { AwsSageMakerTrainingOrphanedScanner } from './aws-sagemaker-training-orphaned.scanner';
import { AwsEnvironmentGhostScanner } from './aws-environment-ghost.scanner';
import { StaticPriceTableAdapter } from '../pricing/static-price-table.adapter';

interface ContractFixture {
  kind: ResourceKind;
  source: string;
  region: string;
  accountId: string;
  /** Raw responses per Command name, in call order; the last page repeats. */
  pages: Record<string, Array<Record<string, unknown>>>;
  expected: { findings: Array<{ id: string; monthlyCostUsd: number }> };
}

const FIXTURES_DIR = join(__dirname, '../testing/contract-fixtures');

/** The SDK serializes response timestamps to Date objects; restore them. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function loadFixture(file: string): ContractFixture {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'), (_key, value) =>
    typeof value === 'string' && ISO_DATE.test(value) ? new Date(value) : value,
  );
}

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map(loadFixture);

// Every @aws-sdk/client-* class extends the same Client base instance —
// stubbing its `send` intercepts every SDK call from every scanner without
// jest.mock'ing 20 modules (and keeps the Command classes real).
const clientBase = Object.getPrototypeOf(EC2Client) as {
  prototype: { send: (...args: unknown[]) => Promise<unknown> };
};
const realSend = clientBase.prototype.send;
afterAll(() => {
  clientBase.prototype.send = realSend;
});

/** Serves fixture pages by Command name, in call order (last page repeats). */
function serveFixturePages(pages: ContractFixture['pages']): void {
  const consumed: Record<string, number> = {};
  clientBase.prototype.send = async function (command: unknown) {
    const name = (command as { constructor: { name: string } }).constructor.name;
    const list = pages[name];
    if (!list || list.length === 0) {
      throw new Error(`contract fixture has no pages for ${name}`);
    }
    const index = Math.min(consumed[name] ?? 0, list.length - 1);
    consumed[name] = (consumed[name] ?? 0) + 1;
    const page = list[index];
    const error = page['$error'] as { name: string; message: string } | undefined;
    if (error) throw Object.assign(new Error(error.message), { name: error.name });
    return page;
  } as typeof realSend;
}

const pricing = new StaticPriceTableAdapter();
// The --live-pricing scanners resolve per-type prices through duck-typed
// sources (satisfied by AwsPricingApiAdapter in production). Fixed stub
// prices here; the fixtures' expected costs are derived from these.
const livePrices = {
  getEc2InstancePricePerMonth: async () => 70,
  getRdsInstancePricePerMonth: async () => 100,
  getElastiCacheNodePricePerMonth: async () => 50,
  getRedshiftNodePricePerMonth: async () => 180,
  getOpenSearchInstancePricePerMonth: async () => 120,
  getMskBrokerPricePerMonth: async () => 60,
  getDocDbInstancePricePerMonth: async () => 150,
  getNeptuneInstancePricePerMonth: async () => 90,
  getMqBrokerPricePerMonth: async () => 80,
  getWorkSpacesBundlePricePerMonth: async () => 35,
  getSageMakerNotebookInstancePricePerMonth: async () => 45,
  getSageMakerEndpointInstancePricePerMonth: async () => 140,
};

// The captured fixtures' resources were seeded moments before the capture,
// so — exactly like the e2e harness with --min-age-days 0 — the grace
// period must be disabled: the contract under test is response-shape →
// findings, not the age policy (covered by the policy unit tests).
const po = { minAgeDays: 0 };

const ACCOUNT = '000000000000';
const region = AwsRegion.create('us-east-1');

/** Mirrors the registry's wiring (thresholds included), one factory per kind. */
const scannerFactories: Record<ResourceKind, () => WasteScannerPort> = {
  'ebs-volume': () => new AwsEbsVolumeScanner(pricing, ACCOUNT, new EbsVolumeWastePolicy(po)),
  'elastic-ip': () => new AwsElasticIpScanner(pricing, ACCOUNT, new ElasticIpWastePolicy(po)),
  'rds-instance': () => new AwsRdsInstanceScanner(pricing, ACCOUNT, new RdsInstanceWastePolicy(po)),
  'load-balancer': () => new AwsLoadBalancerScanner(pricing, ACCOUNT, new LoadBalancerWastePolicy(po)),
  'ec2-instance': () => new AwsEc2InstanceScanner(pricing, ACCOUNT, new Ec2InstanceWastePolicy(po)),
  'ebs-snapshot': () => new AwsEbsSnapshotScanner(pricing, ACCOUNT, new EbsSnapshotWastePolicy(po)),
  'nat-gateway': () => new AwsNatGatewayScanner(pricing, ACCOUNT, new NatGatewayWastePolicy(po)),
  'ebs-gp2-upgrade': () => new AwsGp2UpgradeScanner(pricing, ACCOUNT, new Gp2UpgradePolicy(po)),
  'ebs-idle': () => new AwsEbsIdleScanner(pricing, ACCOUNT, new EbsIdlePolicy(po, 0)),
  'log-group': () => new AwsLogGroupScanner(pricing, ACCOUNT, new LogGroupWastePolicy(po)),
  'eni-orphaned': () => new AwsEniOrphanedScanner(ACCOUNT, new OrphanedEniWastePolicy(po)),
  's3-no-lifecycle': () => new AwsS3NoLifecycleScanner(pricing, ACCOUNT, new S3NoLifecyclePolicy(po)),
  'lambda-underutilized': () => new AwsLambdaUnderutilizedScanner(ACCOUNT, new LambdaUnderutilizedPolicy(po, 0)),
  'efs-unused': () => new AwsEfsUnusedScanner(pricing, ACCOUNT, new EfsUnusedPolicy(po, 0)),
  'dynamodb-overprovisioned': () =>
    new AwsDynamoDbOverprovisionedScanner(pricing, ACCOUNT, new DynamoDbOverprovisionedPolicy(po, 10)),
  'fsx-idle-filesystem': () => new AwsFsxIdleScanner(pricing, ACCOUNT, new FsxIdleFilesystemPolicy(po)),
  'vpn-connection-idle': () => new AwsVpnConnectionIdleScanner(pricing, ACCOUNT, new VpnConnectionIdlePolicy(po)),
  'transit-gateway-idle-attachment': () =>
    new AwsTransitGatewayIdleScanner(pricing, ACCOUNT, new TransitGatewayIdleAttachmentPolicy(po)),
  'kinesis-provisioned-idle-stream': () =>
    new AwsKinesisIdleScanner(pricing, ACCOUNT, new KinesisProvisionedIdleStreamPolicy(po)),
  'sqs-dlq-abandoned': () => new AwsSqsDlqAbandonedScanner(ACCOUNT, new SqsDlqAbandonedWastePolicy(po)),
  'lambda-loggroup-orphaned': () =>
    new AwsLambdaLogGroupOrphanedScanner(pricing, ACCOUNT, new LambdaLogGroupOrphanedPolicy(po)),
  'aurora-serverless-overprovisioned': () =>
    new AwsAuroraServerlessIdleScanner(pricing, ACCOUNT, new AuroraServerlessOverprovisionedPolicy(po, 50)),
  'ec2-underutilized': () => new AwsEc2UnderutilizedScanner(livePrices, ACCOUNT, new Ec2UnderutilizedPolicy(po, 5)),
  'rds-underutilized': () => new AwsRdsUnderutilizedScanner(livePrices, ACCOUNT, new RdsUnderutilizedPolicy(po, 5)),
  'elasticache-idle': () => new AwsElastiCacheIdleScanner(livePrices, ACCOUNT, new ElastiCacheIdlePolicy(po)),
  'redshift-idle-cluster': () => new AwsRedshiftIdleScanner(livePrices, ACCOUNT, new RedshiftIdleClusterPolicy(po)),
  'opensearch-idle-domain': () => new AwsOpenSearchIdleScanner(livePrices, ACCOUNT, new OpenSearchIdleDomainPolicy(po)),
  'msk-idle-cluster': () => new AwsMskIdleScanner(livePrices, ACCOUNT, new MskIdleClusterPolicy(po)),
  'documentdb-idle-instance': () =>
    new AwsDocumentDbIdleScanner(livePrices, ACCOUNT, new DocumentDbIdleInstancePolicy(po)),
  'neptune-idle-instance': () => new AwsNeptuneIdleScanner(livePrices, ACCOUNT, new NeptuneIdleInstancePolicy(po)),
  'mq-idle-broker': () => new AwsMqIdleScanner(livePrices, ACCOUNT, new MqIdleBrokerPolicy(po)),
  'workspaces-idle': () => new AwsWorkspacesIdleScanner(livePrices, ACCOUNT, new WorkspacesIdlePolicy(po)),
  'sagemaker-notebook-idle': () =>
    new AwsSageMakerNotebookIdleScanner(livePrices, ACCOUNT, new SageMakerNotebookIdlePolicy(po, 2)),
  'sagemaker-endpoint-idle': () =>
    new AwsSageMakerEndpointIdleScanner(livePrices, ACCOUNT, new SageMakerEndpointIdlePolicy(po)),
  'sagemaker-training-orphaned': () =>
    new AwsSageMakerTrainingOrphanedScanner(pricing, ACCOUNT, new SageMakerTrainingOrphanedPolicy(po)),
  'environment-ghost': () =>
    new AwsEnvironmentGhostScanner(ACCOUNT, new EnvironmentGhostPolicy(po, 7), undefined, undefined, 7),
};

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

describe('scanner contract fixtures (REVIEW.md #10)', () => {
  it('has a fixture for every ResourceKind', () => {
    expect(fixtures.map((f) => f.kind).sort()).toEqual([...RESOURCE_KINDS].sort());
  });

  for (const fixture of fixtures) {
    it(`${fixture.kind}: reproduces the live findings from the raw response pages (${fixture.source.split(',')[0]})`, async () => {
      serveFixturePages(fixture.pages);

      const scanner = scannerFactories[fixture.kind]();
      const result = await scanner.scan(region);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const actual = result.value
        .map((f) => ({ id: f.id, monthlyCostUsd: f.costEstimate.monthlyCostUsd }))
        .sort(byId);
      expect(actual).toEqual([...fixture.expected.findings].sort(byId));
      for (const finding of result.value) expect(finding.kind).toBe(fixture.kind);
    });
  }
});
