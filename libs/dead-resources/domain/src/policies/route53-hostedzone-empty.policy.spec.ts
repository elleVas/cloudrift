// SPDX-License-Identifier: Apache-2.0
import { Route53HostedZoneEmpty } from '../entities/route53-hostedzone-empty.entity';
import type { Route53HostedZoneEmptyProps } from '../entities/route53-hostedzone-empty.entity';
import { Route53HostedZoneEmptyPolicy } from './route53-hostedzone-empty.policy';
import { DEFAULT_IGNORE_TAG } from './dead-resource-policy';

const now = new Date('2026-07-15T00:00:00Z');

function makeZone(overrides: Partial<Route53HostedZoneEmptyProps> = {}): Route53HostedZoneEmpty {
  return new Route53HostedZoneEmpty({
    hostedZoneId: 'Z1',
    name: 'example.com.',
    accountId: '123456789012',
    detectedAt: now,
    tags: overrides.tags ?? {},
    ...overrides,
  });
}

describe('Route53HostedZoneEmptyPolicy', () => {
  const policy = new Route53HostedZoneEmptyPolicy();

  it('flags an empty hosted zone with no grace period to wait out', () => {
    const verdict = policy.evaluate(makeZone(), now);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain('no records');
  });

  it('does not flag a hosted zone carrying the ignore tag', () => {
    const verdict = policy.evaluate(makeZone({ tags: { [DEFAULT_IGNORE_TAG]: 'true' } }), now);
    expect(verdict.flagged).toBe(false);
  });
});
