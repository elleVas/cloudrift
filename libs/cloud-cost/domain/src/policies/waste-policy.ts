// SPDX-License-Identifier: Apache-2.0
// Moved to `cloud-cost-pricing` (see ADR-0098): the base class only ever used
// `WastedResource.tags`, so it's now generically constrained on
// `TaggedResource` instead of this package's own `WastedResource` — avoids a
// circular dependency, since `cloud-cost-domain` depends on
// `cloud-cost-pricing` for `AwsRegion`/`CostEstimate`/`PricingPort`. Every
// existing `WastePolicy<SomeEntity>` subclass still type-checks unchanged
// (every `WastedResource` has `tags`, so it still satisfies `TaggedResource`).
export {
  WastePolicy,
  waste,
  notWaste,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_IGNORE_TAG,
} from 'cloud-cost-pricing';
export type { TaggedResource, WasteVerdict, WastePolicyOptions } from 'cloud-cost-pricing';
