// SPDX-License-Identifier: Apache-2.0
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface PricingPort {
  /**
   * Price for a fixed-SKU key (e.g. `'ebs-gp3'`, `'nat-gateway'`) in `region`,
   * or `0` if unpriced. The key is the same one used in `prices.json` and
   * `cloudrift.config.json`'s `prices` overrides — callers that need a
   * type-specific fallback (e.g. an unknown EBS volume type) build the
   * specific key first and fall back to a second `getPrice` call with a
   * generic key.
   */
  getPrice(region: AwsRegion, key: string): number;
  /** Date (YYYY-MM) prices were last verified: must be shown in every report. */
  getPricesAsOf(): string;
}
