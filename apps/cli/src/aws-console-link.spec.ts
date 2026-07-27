// SPDX-License-Identifier: Apache-2.0
import { buildConsoleUrl } from './aws-console-link';

describe('buildConsoleUrl', () => {
  it('builds an EC2 console link for a bare resource id', () => {
    expect(buildConsoleUrl({ kind: 'ebs-volume', id: 'vol-abc123', region: 'us-east-1' })).toBe(
      'https://console.aws.amazon.com/ec2/home?region=us-east-1#Volumes:volumeId=vol-abc123',
    );
  });

  it('builds a VPC console link for security-group-family kinds', () => {
    expect(buildConsoleUrl({ kind: 'ec2-security-group-open-ingress', id: 'sg-abc123', region: 'us-east-1' })).toBe(
      'https://console.aws.amazon.com/vpc/home?region=us-east-1#SecurityGroups:groupId=sg-abc123',
    );
  });

  it('extracts the log group name out of a CloudWatch Logs ARN', () => {
    const arn = 'arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/my-fn:*';
    expect(buildConsoleUrl({ kind: 'logs-loggroup-empty', id: arn, region: 'us-east-1' })).toBe(
      'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/%2Faws%2Flambda%2Fmy-fn',
    );
  });

  it('uses a bare log group name directly when the id is not an ARN', () => {
    expect(buildConsoleUrl({ kind: 'log-group', id: '/aws/lambda/my-fn', region: 'us-east-1' })).toBe(
      'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/%2Faws%2Flambda%2Fmy-fn',
    );
  });

  it('passes an already-full SQS queue URL through unchanged (url-encoded)', () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-dlq';
    expect(buildConsoleUrl({ kind: 'sqs-dlq-abandoned', id: queueUrl, region: 'us-east-1' })).toBe(
      `https://console.aws.amazon.com/sqs/v3/home?region=us-east-1#/queues/${encodeURIComponent(queueUrl)}`,
    );
  });

  it('splits the composite EKS nodegroup id into cluster/nodegroup path segments', () => {
    expect(buildConsoleUrl({ kind: 'eks-node-overprovisioned', id: 'my-cluster/my-nodegroup', region: 'us-east-1' })).toBe(
      'https://console.aws.amazon.com/eks/home?region=us-east-1#/clusters/my-cluster/nodegroups/my-nodegroup',
    );
  });

  it('extracts a username from an IAM user ARN', () => {
    const arn = 'arn:aws:iam::123456789012:user/jdoe';
    expect(buildConsoleUrl({ kind: 'iam-user-mfa-disabled', id: arn })).toBe(
      'https://console.aws.amazon.com/iam/home#/users/details/jdoe',
    );
  });

  it('returns a fixed account-level link regardless of id for account-scoped kinds', () => {
    expect(buildConsoleUrl({ kind: 'iam-root-mfa-disabled', id: '123456789012' })).toBe(
      'https://console.aws.amazon.com/iam/home#/security_credentials',
    );
  });

  it('returns undefined for kinds whose id is an opaque AWS-internal identifier', () => {
    expect(buildConsoleUrl({ kind: 'iam-role-unused', id: 'AROAEXAMPLE', region: undefined })).toBeUndefined();
    expect(buildConsoleUrl({ kind: 'iam-policy-unattached', id: 'ANPAEXAMPLE' })).toBeUndefined();
    expect(buildConsoleUrl({ kind: 'iam-user-inactive', id: 'AIDAEXAMPLE' })).toBeUndefined();
    expect(buildConsoleUrl({ kind: 'iam-instance-profile-unattached', id: 'AIPAEXAMPLE' })).toBeUndefined();
  });

  it('returns undefined for kinds whose id lacks a sibling field needed to build a link', () => {
    expect(buildConsoleUrl({ kind: 's3-multipart-upload-abandoned', id: 'upload-token', region: 'us-east-1' })).toBeUndefined();
    expect(buildConsoleUrl({ kind: 'iam-access-key-stale', id: 'AKIAEXAMPLE' })).toBeUndefined();
    expect(buildConsoleUrl({ kind: 'ecr-image-untagged', id: 'sha256:abc', region: 'us-east-1' })).toBeUndefined();
  });

  it('returns undefined for a synthetic, non-AWS-resource kind', () => {
    expect(buildConsoleUrl({ kind: 'environment-ghost', id: 'staging-old', region: 'us-east-1' })).toBeUndefined();
  });

  it('returns undefined for an unknown kind', () => {
    expect(buildConsoleUrl({ kind: 'not-a-real-kind', id: 'x', region: 'us-east-1' })).toBeUndefined();
  });
});
