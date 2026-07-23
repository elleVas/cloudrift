// SPDX-License-Identifier: Apache-2.0
import { AwsRegion, Ec2KeyPairUnused, Ec2RiExpiringSoon, IamUserInactive, IamPolicyUnattached } from 'dead-resources-domain';
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

  it('presenterFor exposes title and head without row/recommend', () => {
    const presenter = presenterFor('ec2-keypair-unused');
    expect(presenter.title).toContain('EC2 Key Pairs');
    expect(presenter.head).toEqual(['Key Pair ID', 'Key Name', 'Region', 'Created']);
  });
});
