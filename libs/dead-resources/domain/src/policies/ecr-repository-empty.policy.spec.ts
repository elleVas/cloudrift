// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { EcrRepositoryEmpty } from '../entities/ecr-repository-empty.entity';
import type { EcrRepositoryEmptyProps } from '../entities/ecr-repository-empty.entity';
import { EcrRepositoryEmptyPolicy } from './ecr-repository-empty.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date(now.getTime() - 365 * MS_PER_DAY);
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);
const region = AwsRegion.create('us-east-1');

function makeRepo(overrides: Partial<EcrRepositoryEmptyProps> = {}): EcrRepositoryEmpty {
  return new EcrRepositoryEmpty({
    repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/repo-1',
    repositoryName: 'repo-1',
    region,
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('EcrRepositoryEmptyPolicy', () => {
  const policy = new EcrRepositoryEmptyPolicy();

  it('flags an old empty repository', () => {
    const verdict = policy.evaluate(makeRepo(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('no images');
  });

  it('does not flag a repository created within the grace period', () => {
    const verdict = policy.evaluate(makeRepo({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a repository created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeRepo({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a repository carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeRepo({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
