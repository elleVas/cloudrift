// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import {
  TablePricingAdapter,
  mergePriceTables,
  type PriceTable,
} from './table-pricing.adapter';

const usEast1 = AwsRegion.create('us-east-1');
const euWest1 = AwsRegion.create('eu-west-1');
const unlisted = AwsRegion.create('ca-central-1');

const table: PriceTable = {
  default: { 'ebs-gp3': 0.08, 'ebs-gp2': 0.1, 'nat-gateway': 32.4, 'elastic-ip': 3.6, 'rds-gp2': 0.115 },
  'eu-west-1': { 'nat-gateway': 36.72, 'ebs-gp3': 0.088 },
};

describe('TablePricingAdapter', () => {
  const adapter = new TablePricingAdapter(table, '2025-06');

  it('returns the region-specific price when present', () => {
    expect(adapter.getPrice(euWest1, 'nat-gateway')).toBe(36.72);
    expect(adapter.getPrice(euWest1, 'ebs-gp3')).toBe(0.088);
  });

  it('falls back to default for an unlisted region', () => {
    expect(adapter.getPrice(unlisted, 'nat-gateway')).toBe(32.4);
    expect(adapter.getPrice(usEast1, 'ebs-gp3')).toBe(0.08);
  });

  it('returns 0 for a key with no price anywhere in the table', () => {
    expect(adapter.getPrice(usEast1, 'ebs-unknown')).toBe(0);
    expect(adapter.getPrice(usEast1, 'rds-nvme')).toBe(0);
  });

  it('supports the specific-key-then-generic-key fallback scanners use for unknown volume/storage types', () => {
    // Same pattern as AwsEbsVolumeScanner/AwsRdsInstanceScanner: try the
    // specific key first, fall back to a known-good generic key.
    expect(adapter.getPrice(usEast1, 'ebs-unknown') || adapter.getPrice(usEast1, 'ebs-gp3')).toBe(0.08);
    expect(adapter.getPrice(usEast1, 'rds-nvme') || adapter.getPrice(usEast1, 'rds-gp2')).toBe(0.115);
  });

  it('exposes the pricesAsOf passed in', () => {
    expect(adapter.getPricesAsOf()).toBe('2025-06');
  });
});

describe('mergePriceTables', () => {
  it('overlays per (region, key), with the overlay winning', () => {
    const base: PriceTable = {
      default: { 'nat-gateway': 32.4, 'elastic-ip': 3.6 },
      'eu-west-1': { 'nat-gateway': 36.72 },
    };
    const overlay: PriceTable = {
      'eu-west-1': { 'nat-gateway': 28.5 }, // user's negotiated rate
      default: { 'ebs-gp3': 0.07 }, // a key only in overlay
    };

    const merged = mergePriceTables(base, overlay);

    // overlay wins for eu-west-1 nat-gateway
    expect(merged['eu-west-1']['nat-gateway']).toBe(28.5);
    // base keys preserved where not overridden
    expect(merged.default['nat-gateway']).toBe(32.4);
    expect(merged.default['elastic-ip']).toBe(3.6);
    // overlay-only key added
    expect(merged.default['ebs-gp3']).toBe(0.07);
  });

  it('user overrides take effect through the adapter', () => {
    const merged = mergePriceTables(table, { 'eu-west-1': { 'nat-gateway': 20 } });
    const adapter = new TablePricingAdapter(merged, '2025-06 + custom overrides');
    expect(adapter.getPrice(euWest1, 'nat-gateway')).toBe(20);
    // unrelated region untouched
    expect(adapter.getPrice(unlisted, 'nat-gateway')).toBe(32.4);
  });
});
