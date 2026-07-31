// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { EcrRepositoryPolicyPublic } from '../entities/ecr-repository-policy-public.entity';
import { EcrRepositoryPolicyPublicPolicy } from './ecr-repository-policy-public.policy';

const region = AwsRegion.create('us-east-1');

function makeFinding(tags: Record<string, string> = {}): EcrRepositoryPolicyPublic {
  return new EcrRepositoryPolicyPublic({
    repositoryName: 'my-repo',
    repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/my-repo',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags,
  });
}

describe('EcrRepositoryPolicyPublicPolicy', () => {
  it('flags — the scanner only emits repositories with a public repository policy', () => {
    expect(new EcrRepositoryPolicyPublicPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    expect(new EcrRepositoryPolicyPublicPolicy().evaluate(makeFinding({ 'cloudrift:ignore': 'true' })).flagged).toBe(false);
  });
});
