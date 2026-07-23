// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2KeyPairUnused } from '../entities/ec2-keypair-unused.entity';
import type { Ec2KeyPairUnusedProps } from '../entities/ec2-keypair-unused.entity';
import { Ec2KeyPairUnusedPolicy } from './ec2-keypair-unused.policy';
import { DEFAULT_IGNORE_TAG, DEFAULT_MIN_AGE_DAYS } from './dead-resource-policy';

const region = AwsRegion.create('eu-west-1');
const now = new Date('2026-06-09T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const oldDate = new Date('2020-01-01T00:00:00Z');
const yesterday = new Date(now.getTime() - MS_PER_DAY);
const exactlyAtMinAge = new Date(now.getTime() - DEFAULT_MIN_AGE_DAYS * MS_PER_DAY);

function makeKeyPair(overrides: Partial<Ec2KeyPairUnusedProps> = {}): Ec2KeyPairUnused {
  return new Ec2KeyPairUnused({
    keyPairId: 'key-1',
    keyName: 'old-deploy-key',
    region,
    accountId: '123456789012',
    createdAt: overrides.createdAt ?? oldDate,
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('Ec2KeyPairUnusedPolicy', () => {
  const policy = new Ec2KeyPairUnusedPolicy();

  it('flags an old, untagged unused key pair', () => {
    const verdict = policy.evaluate(makeKeyPair(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('not referenced');
  });

  it('does not flag a key pair created within the grace period', () => {
    const verdict = policy.evaluate(makeKeyPair({ createdAt: yesterday }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('grace period');
  });

  it('flags a key pair created exactly minAgeDays ago (grace period boundary)', () => {
    expect(policy.evaluate(makeKeyPair({ createdAt: exactlyAtMinAge }), now).flagged).toBe(true);
  });

  it('does not flag a key pair carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeKeyPair({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain(DEFAULT_IGNORE_TAG);
  });

  it('honours a custom grace period', () => {
    const lenient = new Ec2KeyPairUnusedPolicy({ minAgeDays: 0 });
    expect(lenient.evaluate(makeKeyPair({ createdAt: yesterday }), now).flagged).toBe(true);
  });

  it('excludes a resource whose tag matches an excluded key=value', () => {
    const custom = new Ec2KeyPairUnusedPolicy({ excludeTagValues: { Environment: 'Production' } });
    const verdict = custom.evaluate(makeKeyPair({ tags: { Environment: 'Production' } }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('Environment=Production');
  });
});
