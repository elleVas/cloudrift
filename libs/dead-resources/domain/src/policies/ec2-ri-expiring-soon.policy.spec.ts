// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2RiExpiringSoon } from '../entities/ec2-ri-expiring-soon.entity';
import type { Ec2RiExpiringSoonProps } from '../entities/ec2-ri-expiring-soon.entity';
import { Ec2RiExpiringSoonPolicy } from './ec2-ri-expiring-soon.policy';
import { DEFAULT_IGNORE_TAG } from './dead-resource-policy';

const region = AwsRegion.create('eu-west-1');
const now = new Date('2026-07-15T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeRi(overrides: Partial<Ec2RiExpiringSoonProps> = {}): Ec2RiExpiringSoon {
  return new Ec2RiExpiringSoon({
    reservedInstancesId: 'ri-1',
    region,
    accountId: '123456789012',
    instanceType: 'm5.large',
    instanceCount: 1,
    end: overrides.end ?? new Date(now.getTime() + 10 * MS_PER_DAY),
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('Ec2RiExpiringSoonPolicy', () => {
  const policy = new Ec2RiExpiringSoonPolicy();

  it('flags an RI ending within the default 30-day window', () => {
    const verdict = policy.evaluate(makeRi({ end: new Date(now.getTime() + 10 * MS_PER_DAY) }), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('expires');
  });

  it('flags an RI ending exactly at the window boundary', () => {
    const verdict = policy.evaluate(makeRi({ end: new Date(now.getTime() + 30 * MS_PER_DAY) }), now);
    expect(verdict.flagged).toBe(true);
  });

  it('does not flag an RI ending well beyond the window', () => {
    const verdict = policy.evaluate(makeRi({ end: new Date(now.getTime() + 200 * MS_PER_DAY) }), now);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain('more than 30d');
  });

  it('honours a custom expiringWithinDays threshold', () => {
    const strict = new Ec2RiExpiringSoonPolicy({}, 7);
    expect(strict.evaluate(makeRi({ end: new Date(now.getTime() + 10 * MS_PER_DAY) }), now).flagged).toBe(false);
  });

  it('does not flag an RI tagged with the ignore tag, even if expiring imminently', () => {
    const verdict = policy.evaluate(
      makeRi({ end: new Date(now.getTime() + 1 * MS_PER_DAY), tags: { [DEFAULT_IGNORE_TAG]: 'true' } }),
      now,
    );
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toContain(DEFAULT_IGNORE_TAG);
  });
});
