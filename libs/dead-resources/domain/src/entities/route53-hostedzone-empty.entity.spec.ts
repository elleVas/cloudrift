// SPDX-License-Identifier: Apache-2.0
import { Route53HostedZoneEmpty } from './route53-hostedzone-empty.entity';
import type { Route53HostedZoneEmptyProps } from './route53-hostedzone-empty.entity';

function makeZone(overrides: Partial<Route53HostedZoneEmptyProps> = {}): Route53HostedZoneEmpty {
  return new Route53HostedZoneEmpty({
    hostedZoneId: 'Z1D633PJN98FT9',
    name: 'old-project.example.com.',
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('Route53HostedZoneEmpty', () => {
  it('exposes correct id and fields', () => {
    const zone = makeZone();
    expect(zone.id).toBe('Z1D633PJN98FT9');
    expect(zone.name).toBe('old-project.example.com.');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const zone = makeZone();
    expect(zone.kind).toBe('route53-hostedzone-empty');
    expect(zone.hygieneReason).toContain('no records');
    expect(zone.severity).toBe('info');
  });
});
