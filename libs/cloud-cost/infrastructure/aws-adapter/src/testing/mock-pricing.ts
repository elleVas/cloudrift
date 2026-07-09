// SPDX-License-Identifier: Apache-2.0
import type { PricingPort } from 'cloud-cost-domain';

/** key → price, matching the fixtures every scanner spec used to get via the per-type methods. */
const PRICES_BY_KEY: Record<string, number> = {
  'ebs-gp2': 0.1,
  'ebs-gp3': 0.08,
  'ebs-snapshot': 0.05,
  'elastic-ip': 3.6,
  'rds-gp2': 0.115,
  'load-balancer': 16.2,
  'nat-gateway': 32.4,
  'cw-logs': 0.03,
  's3-standard': 0.023,
  'efs-standard': 0.3,
  'dynamodb-rcu': 0.00013,
  'dynamodb-wcu': 0.00065,
  'fsx-windows': 0.13,
  'vpn-connection': 36.5,
  'transit-gateway-attachment': 36.5,
  'kinesis-shard': 10.95,
};

export const mockPricing: PricingPort = {
  // Unknown ebs-*/rds-*/fsx-* keys (i.e. any type other than the ones above)
  // fall back to 0.08/0.115/0.13 — same "specific key, then generic default"
  // shape the real scanners use against TablePricingAdapter.
  getPrice: (_region, key) =>
    PRICES_BY_KEY[key] ??
    (key.startsWith('ebs-') ? 0.08 : key.startsWith('rds-') ? 0.115 : key.startsWith('fsx-') ? 0.13 : 0),
  getPricesAsOf: () => '2025-06',
};
