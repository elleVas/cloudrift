// SPDX-License-Identifier: Apache-2.0
import {
  AwsRegion,
  IamRootMfaDisabled,
  IamUserMfaDisabled,
  IamAccessKeyRotationOverdue,
  IamRootAccessKeyActive,
  IamPasswordPolicyWeak,
  Ec2SecurityGroupOpenIngress,
  Ec2DefaultSecurityGroupPermissive,
  S3BucketPublic,
  Ec2SnapshotPublic,
  Ec2VolumeUnencrypted,
  RdsInstanceUnencrypted,
  S3BucketEncryptionMissing,
  RdsInstancePubliclyAccessible,
  CloudtrailNotMultiregion,
} from 'resource-security-domain';
import { rowFor, recommendFor, presenterFor } from './resource-security-presenters';

const region = AwsRegion.create('us-east-1');
const now = new Date('2026-07-23T10:00:00Z');

const rootMfa = new IamRootMfaDisabled({ accountId: '123456789012', mfaEnabled: false, detectedAt: now, tags: {} });

const userMfa = new IamUserMfaDisabled({
  userName: 'alice',
  arn: 'arn:aws:iam::123456789012:user/alice',
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const keyRotation = new IamAccessKeyRotationOverdue({
  accessKeyId: 'AKIA1',
  userName: 'alice',
  accountId: '123456789012',
  createdAt: now,
  detectedAt: now,
  tags: {},
});

const rootKey = new IamRootAccessKeyActive({ accountId: '123456789012', accessKeysPresent: true, detectedAt: now, tags: {} });

const passwordPolicy = new IamPasswordPolicyWeak({ accountId: '123456789012', exists: false, detectedAt: now, tags: {} });

const openIngress = new Ec2SecurityGroupOpenIngress({
  groupId: 'sg-1',
  groupName: 'web',
  region,
  accountId: '123456789012',
  matchedRules: ['22/tcp from 0.0.0.0/0'],
  detectedAt: now,
  tags: {},
});

const defaultSg = new Ec2DefaultSecurityGroupPermissive({
  groupId: 'sg-default-1',
  vpcId: 'vpc-1',
  region,
  accountId: '123456789012',
  hasIngressRules: true,
  hasEgressRules: true,
  detectedAt: now,
  tags: {},
});

const publicBucket = new S3BucketPublic({
  bucketName: 'my-bucket',
  accountId: '123456789012',
  publicVia: ['bucket policy allows public access'],
  detectedAt: now,
  tags: {},
});

const publicSnapshot = new Ec2SnapshotPublic({
  snapshotId: 'snap-1',
  volumeId: 'vol-1',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const unencryptedVolume = new Ec2VolumeUnencrypted({
  volumeId: 'vol-2',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const unencryptedRds = new RdsInstanceUnencrypted({
  dbInstanceIdentifier: 'db-1',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const missingEncryptionBucket = new S3BucketEncryptionMissing({ bucketName: 'my-bucket-2', accountId: '123456789012', detectedAt: now, tags: {} });

const publicRds = new RdsInstancePubliclyAccessible({
  dbInstanceIdentifier: 'db-2',
  region,
  accountId: '123456789012',
  detectedAt: now,
  tags: {},
});

const noMultiRegionTrail = new CloudtrailNotMultiregion({ accountId: '123456789012', hasMultiRegionTrail: false, detectedAt: now, tags: {} });

describe('rowFor / recommendFor', () => {
  it('dispatches an iam-root-mfa-disabled finding to the matching presenter (no Region column)', () => {
    expect(rowFor(rootMfa)).toEqual(['123456789012']);
    expect(recommendFor(rootMfa)).toContain('root account');
  });

  it('dispatches an iam-user-mfa-disabled finding to the matching presenter (no Region column)', () => {
    expect(rowFor(userMfa)).toEqual(['alice', userMfa.arn, '2026-07-23']);
    expect(recommendFor(userMfa)).toContain('alice');
  });

  it('dispatches an iam-access-key-rotation-overdue finding to the matching presenter (no Region column)', () => {
    expect(rowFor(keyRotation)).toEqual(['AKIA1', 'alice', '2026-07-23']);
    expect(recommendFor(keyRotation)).toContain('AKIA1');
  });

  it('dispatches an iam-root-access-key-active finding to the matching presenter (no Region column)', () => {
    expect(rowFor(rootKey)).toEqual(['123456789012']);
    expect(recommendFor(rootKey)).toContain('root account');
  });

  it('dispatches an iam-password-policy-weak finding to the matching presenter (no Region column)', () => {
    expect(rowFor(passwordPolicy)).toEqual(['123456789012', passwordPolicy.riskReason]);
    expect(recommendFor(passwordPolicy)).toContain('password policy');
  });

  it('dispatches an ec2-security-group-open-ingress finding to the matching presenter', () => {
    expect(rowFor(openIngress)).toEqual(['sg-1', 'web', 'us-east-1', '22/tcp from 0.0.0.0/0']);
    expect(recommendFor(openIngress)).toContain('web');
  });

  it('dispatches an ec2-default-security-group-permissive finding to the matching presenter', () => {
    expect(rowFor(defaultSg)).toEqual(['sg-default-1', 'vpc-1', 'us-east-1']);
    expect(recommendFor(defaultSg)).toContain('sg-default-1');
  });

  it('dispatches an s3-bucket-public finding to the matching presenter (no Region column)', () => {
    expect(rowFor(publicBucket)).toEqual(['my-bucket', 'bucket policy allows public access']);
    expect(recommendFor(publicBucket)).toContain('my-bucket');
  });

  it('dispatches an ec2-snapshot-public finding to the matching presenter', () => {
    expect(rowFor(publicSnapshot)).toEqual(['snap-1', 'vol-1', 'us-east-1']);
    expect(recommendFor(publicSnapshot)).toContain('snap-1');
  });

  it('dispatches an ec2-volume-unencrypted finding to the matching presenter', () => {
    expect(rowFor(unencryptedVolume)).toEqual(['vol-2', 'us-east-1']);
    expect(recommendFor(unencryptedVolume)).toContain('vol-2');
  });

  it('dispatches a rds-instance-unencrypted finding to the matching presenter', () => {
    expect(rowFor(unencryptedRds)).toEqual(['db-1', 'us-east-1']);
    expect(recommendFor(unencryptedRds)).toContain('db-1');
  });

  it('dispatches an s3-bucket-encryption-missing finding to the matching presenter (no Region column)', () => {
    expect(rowFor(missingEncryptionBucket)).toEqual(['my-bucket-2']);
    expect(recommendFor(missingEncryptionBucket)).toContain('my-bucket-2');
  });

  it('dispatches a rds-instance-publicly-accessible finding to the matching presenter', () => {
    expect(rowFor(publicRds)).toEqual(['db-2', 'us-east-1']);
    expect(recommendFor(publicRds)).toContain('db-2');
  });

  it('dispatches a cloudtrail-not-multiregion finding to the matching presenter (no Region column)', () => {
    expect(rowFor(noMultiRegionTrail)).toEqual(['123456789012']);
    expect(recommendFor(noMultiRegionTrail)).toContain('multi-region');
  });

  it('presenterFor exposes title and head without row/recommend', () => {
    const presenter = presenterFor('s3-bucket-public');
    expect(presenter.title).toContain('S3 Buckets');
    expect(presenter.head).toEqual(['Bucket Name', 'Exposed Via']);
  });
});
