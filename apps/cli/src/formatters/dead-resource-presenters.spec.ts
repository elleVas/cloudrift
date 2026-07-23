// SPDX-License-Identifier: Apache-2.0
import {
  AwsRegion,
  Ec2KeyPairUnused,
  Ec2RiExpiringSoon,
  IamUserInactive,
  IamPolicyUnattached,
  IamRoleUnused,
  IamAccessKeyStale,
  Ec2SecurityGroupUnused,
  LogsLogGroupEmpty,
  AcmCertificateUnused,
  Route53HostedZoneEmpty,
  CloudformationStackStuck,
  S3BucketEmpty,
  CloudwatchAlarmOrphaned,
  SnsTopicUnsubscribed,
  IamInstanceProfileUnattached,
  EventbridgeRuleNoTargets,
  EcrRepositoryEmpty,
  StepfunctionsStatemachineUnused,
} from 'dead-resources-domain';
import { rowFor, recommendFor, presenterFor } from './dead-resource-presenters';

const region = AwsRegion.create('us-east-1');
const now = new Date('2026-07-10T10:00:00Z');

const keyPair = new Ec2KeyPairUnused({
  keyPairId: 'key-1',
  keyName: 'old-deploy-key',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const ri = new Ec2RiExpiringSoon({
  reservedInstancesId: 'ri-1',
  region,
  accountId: '123456789012',
  instanceType: 'm5.large',
  instanceCount: 2,
  end: new Date('2026-08-01T00:00:00Z'),
  detectedAt: now,
  tags: {},
});

const iamUser = new IamUserInactive({
  userId: 'AIDA1',
  userName: 'old-service-account',
  arn: 'arn:aws:iam::123456789012:user/old-service-account',
  accountId: '123456789012',
  createdAt: now,
  lastActivityAt: undefined,
  detectedAt: now,
  tags: {},
});

const iamPolicy = new IamPolicyUnattached({
  policyId: 'ANPA1',
  policyName: 'old-policy',
  arn: 'arn:aws:iam::123456789012:policy/old-policy',
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const iamRole = new IamRoleUnused({
  roleId: 'AROA1',
  roleName: 'old-role',
  arn: 'arn:aws:iam::123456789012:role/old-role',
  accountId: '123456789012',
  createdAt: now,
  lastUsedAt: undefined,
  detectedAt: now,
  tags: {},
});

const accessKey = new IamAccessKeyStale({
  accessKeyId: 'AKIA1',
  userName: 'ci-deploy',
  status: 'Active',
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const securityGroup = new Ec2SecurityGroupUnused({
  groupId: 'sg-1',
  groupName: 'old-sg',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const logGroup = new LogsLogGroupEmpty({
  arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/lg-1',
  logGroupName: '/lg-1',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const certificate = new AcmCertificateUnused({
  certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/1',
  domainName: 'old.example.com',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const hostedZone = new Route53HostedZoneEmpty({
  hostedZoneId: 'Z1',
  name: 'old.example.com.',
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const stack = new CloudformationStackStuck({
  stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/s1/1',
  stackName: 's1',
  status: 'DELETE_FAILED',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const bucket = new S3BucketEmpty({
  bucketName: 'old-bucket',
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const alarm = new CloudwatchAlarmOrphaned({
  alarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:a1',
  alarmName: 'a1',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const topic = new SnsTopicUnsubscribed({
  topicArn: 'arn:aws:sns:us-east-1:123456789012:t1',
  topicName: 't1',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const instanceProfile = new IamInstanceProfileUnattached({
  instanceProfileId: 'AIPA1',
  instanceProfileName: 'old-profile',
  arn: 'arn:aws:iam::123456789012:instance-profile/old-profile',
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const rule = new EventbridgeRuleNoTargets({
  ruleArn: 'arn:aws:events:us-east-1:123456789012:rule/r1',
  ruleName: 'r1',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const repository = new EcrRepositoryEmpty({
  repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/repo-1',
  repositoryName: 'repo-1',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const stateMachine = new StepfunctionsStatemachineUnused({
  stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:m1',
  name: 'm1',
  region,
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

describe('rowFor / recommendFor', () => {
  it('dispatches an ec2-keypair-unused finding to the matching presenter', () => {
    expect(rowFor(keyPair)).toEqual(['key-1', 'old-deploy-key', 'us-east-1', '2026-07-10']);
    expect(recommendFor(keyPair)).toContain('old-deploy-key');
    expect(recommendFor(keyPair)).toContain('key-1');
  });

  it('dispatches an ec2-ri-expiring-soon finding to the matching presenter', () => {
    expect(rowFor(ri)).toEqual(['ri-1', 'm5.large', '2', 'us-east-1', '2026-08-01']);
    expect(recommendFor(ri)).toContain('ri-1');
  });

  it('dispatches an iam-user-inactive finding to the matching presenter (no Region column)', () => {
    expect(rowFor(iamUser)).toEqual(['old-service-account', iamUser.arn, '2026-07-10']);
    expect(recommendFor(iamUser)).toContain('old-service-account');
  });

  it('dispatches an iam-policy-unattached finding to the matching presenter (no Region column)', () => {
    expect(rowFor(iamPolicy)).toEqual(['old-policy', iamPolicy.arn, '2026-07-10']);
    expect(recommendFor(iamPolicy)).toContain('old-policy');
  });

  it('dispatches an iam-role-unused finding to the matching presenter (no Region column)', () => {
    expect(rowFor(iamRole)).toEqual(['old-role', iamRole.arn, '2026-07-10']);
    expect(recommendFor(iamRole)).toContain('old-role');
  });

  it('dispatches an iam-access-key-stale finding to the matching presenter (no Region column)', () => {
    expect(rowFor(accessKey)).toEqual(['AKIA1', 'ci-deploy', '2026-07-10']);
    expect(recommendFor(accessKey)).toContain('AKIA1');
  });

  it('dispatches an ec2-security-group-unused finding to the matching presenter', () => {
    expect(rowFor(securityGroup)).toEqual(['sg-1', 'old-sg', 'us-east-1']);
    expect(recommendFor(securityGroup)).toContain('old-sg');
  });

  it('dispatches a logs-loggroup-empty finding to the matching presenter', () => {
    expect(rowFor(logGroup)).toEqual(['/lg-1', 'us-east-1', '2026-07-10']);
    expect(recommendFor(logGroup)).toContain('/lg-1');
  });

  it('dispatches an acm-certificate-unused finding to the matching presenter', () => {
    expect(rowFor(certificate)).toEqual(['old.example.com', 'us-east-1', '2026-07-10']);
    expect(recommendFor(certificate)).toContain('old.example.com');
  });

  it('dispatches a route53-hostedzone-empty finding to the matching presenter (no Region column)', () => {
    expect(rowFor(hostedZone)).toEqual(['old.example.com.', 'Z1']);
    expect(recommendFor(hostedZone)).toContain('old.example.com.');
  });

  it('dispatches a cloudformation-stack-stuck finding to the matching presenter', () => {
    expect(rowFor(stack)).toEqual(['s1', 'DELETE_FAILED', 'us-east-1', '2026-07-10']);
    expect(recommendFor(stack)).toContain('s1');
  });

  it('dispatches an s3-bucket-empty finding to the matching presenter (no Region column)', () => {
    expect(rowFor(bucket)).toEqual(['old-bucket', '2026-07-10']);
    expect(recommendFor(bucket)).toContain('old-bucket');
  });

  it('dispatches a cloudwatch-alarm-orphaned finding to the matching presenter', () => {
    expect(rowFor(alarm)).toEqual(['a1', 'us-east-1', '2026-07-10']);
    expect(recommendFor(alarm)).toContain('a1');
  });

  it('dispatches a sns-topic-unsubscribed finding to the matching presenter', () => {
    expect(rowFor(topic)).toEqual(['t1', 'us-east-1']);
    expect(recommendFor(topic)).toContain('t1');
  });

  it('dispatches an iam-instance-profile-unattached finding to the matching presenter (no Region column)', () => {
    expect(rowFor(instanceProfile)).toEqual(['old-profile', instanceProfile.arn, '2026-07-10']);
    expect(recommendFor(instanceProfile)).toContain('old-profile');
  });

  it('dispatches an eventbridge-rule-no-targets finding to the matching presenter', () => {
    expect(rowFor(rule)).toEqual(['r1', 'us-east-1']);
    expect(recommendFor(rule)).toContain('r1');
  });

  it('dispatches an ecr-repository-empty finding to the matching presenter', () => {
    expect(rowFor(repository)).toEqual(['repo-1', 'us-east-1', '2026-07-10']);
    expect(recommendFor(repository)).toContain('repo-1');
  });

  it('dispatches a stepfunctions-statemachine-unused finding to the matching presenter', () => {
    expect(rowFor(stateMachine)).toEqual(['m1', 'us-east-1', '2026-07-10']);
    expect(recommendFor(stateMachine)).toContain('m1');
  });

  it('presenterFor exposes title and head without row/recommend', () => {
    const presenter = presenterFor('ec2-keypair-unused');
    expect(presenter.title).toContain('EC2 Key Pairs');
    expect(presenter.head).toEqual(['Key Pair ID', 'Key Name', 'Region', 'Created']);
  });
});
