// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_KINDS } from 'cloud-cost-domain';
import { AwsPricingApiAdapter, StaticPriceTableAdapter } from 'cloud-cost-infrastructure-aws-adapter';
import { ALWAYS_ON_SCANNERS, LIVE_PRICING_SCANNERS, buildScanners } from './analyze-waste.composition';

const ctx = {
  pricing: new StaticPriceTableAdapter(),
  accountId: 'unknown',
  policyOptions: {},
  cloudwatchWindowHours: 48,
  utilizationWindowHours: 168,
  config: {},
};

describe('scanner registry', () => {
  it('covers every RESOURCE_KINDS entry exactly once between the two registries', () => {
    const registered = [...ALWAYS_ON_SCANNERS, ...LIVE_PRICING_SCANNERS].map((r) => r.kind);
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual([...RESOURCE_KINDS].sort());
  });

  it('builds only the always-on scanners without a live-pricing adapter', () => {
    const scanners = buildScanners(ctx, undefined);
    expect(scanners).toHaveLength(ALWAYS_ON_SCANNERS.length);
    expect(scanners.map((s) => s.kind).sort()).toEqual(ALWAYS_ON_SCANNERS.map((r) => r.kind).sort());
  });

  it('adds the live-pricing-gated scanners when an adapter is supplied', () => {
    const scanners = buildScanners(ctx, new AwsPricingApiAdapter());
    expect(scanners).toHaveLength(ALWAYS_ON_SCANNERS.length + LIVE_PRICING_SCANNERS.length);
    expect(new Set(scanners.map((s) => s.kind)).size).toBe(scanners.length);
  });
});
