// SPDX-License-Identifier: Apache-2.0
//
// Contract tests, mirroring `cloud-cost-infrastructure-aws-adapter`'s
// `scanner-contract.spec.ts` (ADR-0053) for this domain: replays realistic
// raw AWS responses through each scanner's full pipeline (list → map →
// toEntity → policy) and asserts the exact findings the shape produces.
// All fixtures here are hand-transcribed (not LocalStack-captured) — see
// ADR-0079 for why `dead-resources` has no LocalStack e2e coverage yet.
//
// Every kind-specific threshold is nulled out in the scanner factories below
// (minAgeDays: 0, a very large expiringWithinDays/inactivityDays) so the
// fixtures' fixed dates never go stale — the contract under test is
// response-shape → findings, not the threshold logic (covered by the policy
// unit tests).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EC2Client } from '@aws-sdk/client-ec2';
import { IAMClient } from '@aws-sdk/client-iam';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { ACMClient } from '@aws-sdk/client-acm';
import { Route53Client } from '@aws-sdk/client-route-53';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { ECRClient } from '@aws-sdk/client-ecr';
import { SFNClient } from '@aws-sdk/client-sfn';
import {
  AwsRegion,
  DEAD_RESOURCE_KINDS,
  Ec2KeyPairUnusedPolicy,
  Ec2RiExpiringSoonPolicy,
  IamUserInactivePolicy,
  IamPolicyUnattachedPolicy,
  IamRoleUnusedPolicy,
  IamAccessKeyStalePolicy,
  Ec2SecurityGroupUnusedPolicy,
  LogsLogGroupEmptyPolicy,
  AcmCertificateUnusedPolicy,
  Route53HostedZoneEmptyPolicy,
  CloudformationStackStuckPolicy,
  S3BucketEmptyPolicy,
  CloudwatchAlarmOrphanedPolicy,
  SnsTopicUnsubscribedPolicy,
  IamInstanceProfileUnattachedPolicy,
  EventbridgeRuleNoTargetsPolicy,
  EcrRepositoryEmptyPolicy,
  StepfunctionsStatemachineUnusedPolicy,
} from 'dead-resources-domain';
import type { DeadResourceKind, DeadResourceScannerPort } from 'dead-resources-domain';
import { AwsEc2KeyPairUnusedScanner } from './aws-ec2-keypair-unused.scanner';
import { AwsEc2RiExpiringSoonScanner } from './aws-ec2-ri-expiring-soon.scanner';
import { AwsIamUserInactiveScanner } from './aws-iam-user-inactive.scanner';
import { AwsIamPolicyUnattachedScanner } from './aws-iam-policy-unattached.scanner';
import { AwsIamRoleUnusedScanner } from './aws-iam-role-unused.scanner';
import { AwsIamAccessKeyStaleScanner } from './aws-iam-access-key-stale.scanner';
import { AwsEc2SecurityGroupUnusedScanner } from './aws-ec2-security-group-unused.scanner';
import { AwsLogsLogGroupEmptyScanner } from './aws-logs-loggroup-empty.scanner';
import { AwsAcmCertificateUnusedScanner } from './aws-acm-certificate-unused.scanner';
import { AwsRoute53HostedZoneEmptyScanner } from './aws-route53-hostedzone-empty.scanner';
import { AwsCloudformationStackStuckScanner } from './aws-cloudformation-stack-stuck.scanner';
import { AwsS3BucketEmptyScanner } from './aws-s3-bucket-empty.scanner';
import { AwsCloudwatchAlarmOrphanedScanner } from './aws-cloudwatch-alarm-orphaned.scanner';
import { AwsSnsTopicUnsubscribedScanner } from './aws-sns-topic-unsubscribed.scanner';
import { AwsIamInstanceProfileUnattachedScanner } from './aws-iam-instance-profile-unattached.scanner';
import { AwsEventbridgeRuleNoTargetsScanner } from './aws-eventbridge-rule-no-targets.scanner';
import { AwsEcrRepositoryEmptyScanner } from './aws-ecr-repository-empty.scanner';
import { AwsStepfunctionsStatemachineUnusedScanner } from './aws-stepfunctions-statemachine-unused.scanner';

interface ContractFixture {
  kind: DeadResourceKind;
  source: string;
  region: string;
  accountId: string;
  pages: Record<string, Array<Record<string, unknown>>>;
  expected: { findings: Array<{ id: string; severity: string }> };
}

const FIXTURES_DIR = join(__dirname, '../testing/contract-fixtures');

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

// Different AWS SDK v3 clients can resolve different @smithy/core Client
// base objects (verified empirically, same phenomenon
// cloud-cost-infrastructure-aws-adapter's contract test already documents
// for EC2 vs ECR/Secrets Manager) — every client used by a scanner in this
// domain gets its own entry here rather than assuming they share one base.
type ClientBase = { prototype: { send: (...args: unknown[]) => Promise<unknown> } };
const clientBases = [
  Object.getPrototypeOf(EC2Client),
  Object.getPrototypeOf(IAMClient),
  Object.getPrototypeOf(CloudWatchLogsClient),
  Object.getPrototypeOf(ACMClient),
  Object.getPrototypeOf(Route53Client),
  Object.getPrototypeOf(CloudFormationClient),
  Object.getPrototypeOf(S3Client),
  Object.getPrototypeOf(CloudWatchClient),
  Object.getPrototypeOf(SNSClient),
  Object.getPrototypeOf(EventBridgeClient),
  Object.getPrototypeOf(ECRClient),
  Object.getPrototypeOf(SFNClient),
] as ClientBase[];
const realSends = clientBases.map((base) => base.prototype.send);
afterAll(() => {
  clientBases.forEach((base, i) => {
    base.prototype.send = realSends[i];
  });
});

function serveFixturePages(pages: ContractFixture['pages']): void {
  const consumed: Record<string, number> = {};
  const fakeSend = async function (command: unknown) {
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
  };
  for (const base of clientBases) {
    base.prototype.send = fakeSend as typeof realSends[number];
  }
}

// Grace period always off; the two kind-specific thresholds set to values
// that always flag (RI: a threshold no End date could exceed; IAM user: 0
// days of allowed inactivity) — see file header.
const po = { minAgeDays: 0 };
const ACCOUNT = '000000000000';
// Fixed for every fixture, same as cloud-cost-infrastructure-aws-adapter's
// contract test — each fixture's "region" field is documentation only
// ("global" for the two IAM kinds), never parsed or passed to `scan()`.
const region = AwsRegion.create('us-east-1');

const scannerFactories: Record<DeadResourceKind, () => DeadResourceScannerPort> = {
  'ec2-keypair-unused': () => new AwsEc2KeyPairUnusedScanner(ACCOUNT, new Ec2KeyPairUnusedPolicy(po)),
  'ec2-ri-expiring-soon': () => new AwsEc2RiExpiringSoonScanner(ACCOUNT, new Ec2RiExpiringSoonPolicy(po, 999_999)),
  'iam-user-inactive': () => new AwsIamUserInactiveScanner(ACCOUNT, new IamUserInactivePolicy(po, 0)),
  'iam-policy-unattached': () => new AwsIamPolicyUnattachedScanner(ACCOUNT, new IamPolicyUnattachedPolicy(po)),
  'iam-role-unused': () => new AwsIamRoleUnusedScanner(ACCOUNT, new IamRoleUnusedPolicy(po, 0)),
  'iam-access-key-stale': () => new AwsIamAccessKeyStaleScanner(ACCOUNT, new IamAccessKeyStalePolicy(po)),
  'ec2-security-group-unused': () => new AwsEc2SecurityGroupUnusedScanner(ACCOUNT, new Ec2SecurityGroupUnusedPolicy(po)),
  'logs-loggroup-empty': () => new AwsLogsLogGroupEmptyScanner(ACCOUNT, new LogsLogGroupEmptyPolicy(po)),
  'acm-certificate-unused': () => new AwsAcmCertificateUnusedScanner(ACCOUNT, new AcmCertificateUnusedPolicy(po)),
  'route53-hostedzone-empty': () => new AwsRoute53HostedZoneEmptyScanner(ACCOUNT, new Route53HostedZoneEmptyPolicy(po)),
  'cloudformation-stack-stuck': () => new AwsCloudformationStackStuckScanner(ACCOUNT, new CloudformationStackStuckPolicy(po)),
  's3-bucket-empty': () => new AwsS3BucketEmptyScanner(ACCOUNT, new S3BucketEmptyPolicy(po)),
  'cloudwatch-alarm-orphaned': () => new AwsCloudwatchAlarmOrphanedScanner(ACCOUNT, new CloudwatchAlarmOrphanedPolicy(po)),
  'sns-topic-unsubscribed': () => new AwsSnsTopicUnsubscribedScanner(ACCOUNT, new SnsTopicUnsubscribedPolicy(po)),
  'iam-instance-profile-unattached': () => new AwsIamInstanceProfileUnattachedScanner(ACCOUNT, new IamInstanceProfileUnattachedPolicy(po)),
  'eventbridge-rule-no-targets': () => new AwsEventbridgeRuleNoTargetsScanner(ACCOUNT, new EventbridgeRuleNoTargetsPolicy(po)),
  'ecr-repository-empty': () => new AwsEcrRepositoryEmptyScanner(ACCOUNT, new EcrRepositoryEmptyPolicy(po)),
  'stepfunctions-statemachine-unused': () => new AwsStepfunctionsStatemachineUnusedScanner(ACCOUNT, new StepfunctionsStatemachineUnusedPolicy(po)),
};

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

describe('dead-resources scanner contract fixtures', () => {
  it('has a fixture for every DeadResourceKind', () => {
    expect(fixtures.map((f) => f.kind).sort()).toEqual([...DEAD_RESOURCE_KINDS].sort());
  });

  for (const fixture of fixtures) {
    it(`${fixture.kind}: reproduces the live findings from the raw response pages (${fixture.source.split(',')[0]})`, async () => {
      serveFixturePages(fixture.pages);

      const scanner = scannerFactories[fixture.kind]();
      const result = await scanner.scan(region);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const actual = result.value.map((f) => ({ id: f.id, severity: f.severity })).sort(byId);
      expect(actual).toEqual([...fixture.expected.findings].sort(byId));
      for (const finding of result.value) expect(finding.kind).toBe(fixture.kind);
    });
  }
});
