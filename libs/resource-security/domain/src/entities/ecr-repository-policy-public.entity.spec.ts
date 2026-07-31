// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { EcrRepositoryPolicyPublic } from './ecr-repository-policy-public.entity';
import type { EcrRepositoryPolicyPublicProps } from './ecr-repository-policy-public.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<EcrRepositoryPolicyPublicProps> = {}): EcrRepositoryPolicyPublic {
  return new EcrRepositoryPolicyPublic({
    repositoryName: 'my-repo',
    repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/my-repo',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('EcrRepositoryPolicyPublic', () => {
  it('exposes id (repositoryArn), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('arn:aws:ecr:us-east-1:123456789012:repository/my-repo');
    expect(finding.kind).toBe('ecr-repository-policy-public');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ repositoryName: 'other-repo', tags: { env: 'prod' } });
    expect(finding.repositoryName).toBe('other-repo');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('any AWS principal');
  });
});
