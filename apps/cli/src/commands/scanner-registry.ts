// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_KINDS } from 'cloud-cost-domain';
import type { PricingPort, ResourceKind, WastePolicyOptions, WasteScannerPort } from 'cloud-cost-domain';
import type { AwsPricingApiAdapter } from 'cloud-cost-infrastructure-aws-adapter';
import type { CloudriftConfig } from '../config/cloudrift.config';
import { ALWAYS_ON_SCANNERS } from './always-on-scanners';
import { LIVE_PRICING_SCANNERS } from './live-pricing-scanners';

export { ALWAYS_ON_SCANNERS } from './always-on-scanners';
export { LIVE_PRICING_SCANNERS } from './live-pricing-scanners';

/** Everything an always-on scanner factory may need to build its instance. */
export interface ScannerBuildContext {
  pricing: PricingPort;
  accountId: string;
  policyOptions: WastePolicyOptions;
  cloudwatchWindowHours: number;
  utilizationWindowHours: number;
  config: CloudriftConfig;
}

/** Same as above, plus the adapter only scanners gated on --live-pricing may use. */
export interface LivePricingScannerBuildContext extends ScannerBuildContext {
  livePricingAdapter: AwsPricingApiAdapter;
}

export interface ScannerRegistration<Ctx> {
  kind: ResourceKind;
  create: (ctx: Ctx) => WasteScannerPort;
}

/**
 * Fails fast at module load if a resource kind is missing/duplicated across
 * the two registries — the failure mode a hand-written composition root can't catch.
 */
function assertRegistryMatchesResourceKinds(): void {
  const registered = [...ALWAYS_ON_SCANNERS, ...LIVE_PRICING_SCANNERS].map((r) => r.kind);
  const missing = RESOURCE_KINDS.filter((k) => !registered.includes(k));
  const duplicates = registered.filter((k, i) => registered.indexOf(k) !== i);
  if (missing.length > 0 || duplicates.length > 0) {
    throw new Error(
      `Scanner registry is out of sync with RESOURCE_KINDS` +
        (missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '') +
        (duplicates.length > 0 ? ` (duplicated: ${duplicates.join(', ')})` : ''),
    );
  }
}
assertRegistryMatchesResourceKinds();

/** Always-on scanners + advisory scanners gated on --live-pricing. */
export function buildScanners(
  ctx: ScannerBuildContext,
  livePricingAdapter: AwsPricingApiAdapter | undefined,
): WasteScannerPort[] {
  const scanners = ALWAYS_ON_SCANNERS.map((reg) => reg.create(ctx));
  if (livePricingAdapter) {
    scanners.push(...LIVE_PRICING_SCANNERS.map((reg) => reg.create({ ...ctx, livePricingAdapter })));
  }
  return scanners;
}
