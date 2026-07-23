// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { EcrRepositoryEmpty } from './ecr-repository-empty.entity';
import type { EcrRepositoryEmptyProps } from './ecr-repository-empty.entity';

function makeRepo(overrides: Partial<EcrRepositoryEmptyProps> = {}): EcrRepositoryEmpty {
  return new EcrRepositoryEmpty({
    repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/old-service',
    repositoryName: 'old-service',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('EcrRepositoryEmpty', () => {
  it('exposes correct id and fields', () => {
    const repo = makeRepo();
    expect(repo.id).toBe('arn:aws:ecr:us-east-1:123456789012:repository/old-service');
    expect(repo.repositoryName).toBe('old-service');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const repo = makeRepo();
    expect(repo.kind).toBe('ecr-repository-empty');
    expect(repo.hygieneReason).toContain('no images');
    expect(repo.severity).toBe('info');
  });
});
