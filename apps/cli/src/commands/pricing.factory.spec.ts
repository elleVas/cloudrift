// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { buildPricing } from './pricing.factory';
import type { AnalysisContext } from './analyze-waste.composition';

const region = AwsRegion.create('us-east-1');

function makeContext(overrides: Partial<AnalysisContext> = {}, info = jest.fn()): AnalysisContext {
  return {
    regions: [region],
    config: {},
    accountId: 'unknown',
    livePricing: false,
    policyOptions: {},
    cloudwatchWindowHours: 48,
    utilizationWindowHours: 168,
    info,
    ...overrides,
  };
}

describe('buildPricing', () => {
  it('warns on stderr-routed info when config.prices has an unknown key', async () => {
    const info = jest.fn();
    const ctx = makeContext({ config: { prices: { 'us-east-1': { pippo: 42 } } } }, info);

    await buildPricing(ctx);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Unknown price key "pippo" in region "us-east-1"'),
    );
  });

  it('does not warn when config.prices only overrides known keys', async () => {
    const info = jest.fn();
    const ctx = makeContext({ config: { prices: { 'us-east-1': { 'ebs-gp3': 0.09 } } } }, info);

    await buildPricing(ctx);

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('Unknown price key'));
  });

  it('does not warn when config.prices is absent', async () => {
    const info = jest.fn();
    const ctx = makeContext({}, info);

    await buildPricing(ctx);

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('Unknown price key'));
  });

  it('still applies the override (unknown-key warning does not block merging)', async () => {
    const ctx = makeContext({ config: { prices: { 'us-east-1': { 'ebs-gp3': 0.5, pippo: 42 } } } });

    const { pricing } = await buildPricing(ctx);

    expect(pricing.getPrice(region, 'ebs-gp3')).toBe(0.5);
  });
});
