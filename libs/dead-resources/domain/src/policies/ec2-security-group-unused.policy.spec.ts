// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2SecurityGroupUnused } from '../entities/ec2-security-group-unused.entity';
import type { Ec2SecurityGroupUnusedProps } from '../entities/ec2-security-group-unused.entity';
import { Ec2SecurityGroupUnusedPolicy } from './ec2-security-group-unused.policy';
import { DEFAULT_IGNORE_TAG } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');
const region = AwsRegion.create('us-east-1');

function makeGroup(overrides: Partial<Ec2SecurityGroupUnusedProps> = {}): Ec2SecurityGroupUnused {
  return new Ec2SecurityGroupUnused({
    groupId: 'sg-1',
    groupName: 'sg-name',
    region,
    accountId: '123456789012',
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('Ec2SecurityGroupUnusedPolicy', () => {
  const policy = new Ec2SecurityGroupUnusedPolicy();

  it('flags an unreferenced security group with no grace period to wait out', () => {
    const verdict = policy.evaluate(makeGroup(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('not attached');
  });

  it('defaults "now" to the current time when omitted', () => {
    const verdict = policy.evaluate(makeGroup());
    expect(verdict.flagged).toBe(true);
  });

  it('does not flag a security group carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeGroup({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });

  it('excludes a resource whose tag matches an excludeTagValues entry', () => {
    const scopedPolicy = new Ec2SecurityGroupUnusedPolicy({ excludeTagValues: { Environment: 'Sandbox' } });
    const verdict = scopedPolicy.evaluate(makeGroup({ tags: { Environment: 'Sandbox' } }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toBe('excluded by tag Environment=Sandbox');
  });
});
