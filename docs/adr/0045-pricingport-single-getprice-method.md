# ADR-0045: `PricingPort` collapsed to a single generic `getPrice(region, key)`

- **Status:** Accepted (2026-07-09)

## Context

`PricingPort` declared 16 nominally-typed methods (`getEbsVolumePricePerGbMonth`, `getNatGatewayPricePerMonth`, `getRdsStoragePricePerGbMonth`, …). Every new fixed-cost resource type required adding a method to the port interface *and* implementing it in every adapter (`TablePricingAdapter`/`StaticPriceTableAdapter`, plus the shared `mockPricing` test double) — the one place in the otherwise-open plugin model where adding a resource type touched a shared interface rather than only additive files. The 16 methods also didn't buy real type safety: `getEbsVolumePricePerGbMonth(region, volumeType: string)` accepted an arbitrary string for `volumeType` regardless of the method's specific name.

## Decision

`PricingPort` exposes one method: `getPrice(region: AwsRegion, key: string): number`. The price key (`'ebs-gp3'`, `'nat-gateway'`, `'dynamodb-rcu'`, …) is the same lookup key already used in `prices.json` and in `cloudrift.config.json`'s `prices` overrides.

```typescript
export interface PricingPort {
  getPrice(region: AwsRegion, key: string): number;
  getPricesAsOf(): string;
}
```

`TablePricingAdapter.getPrice` does `table[region.code]?.[key] ?? table.default?.[key] ?? 0` — unpriced keys resolve to `0`, never `undefined`, so callers never need an extra null check. Callers that need a fallback for a runtime-determined variant chain two calls themselves: `pricing.getPrice(region, \`ebs-${volumeType}\`) || pricing.getPrice(region, 'ebs-gp3')` (specific key, then a known-good generic one) — see `AwsEbsVolumeScanner` for the pattern. `AwsPricingApiAdapter` (the `--live-pricing` source) is unaffected: it doesn't implement `PricingPort` directly, it produces a `PriceTable` via `warmUp()` that the composition root merges with the static table before the scan, so the port's synchronous-getter contract was never in play there.

## Alternatives Considered

- **Keep the 16 typed methods, add a 17th generic escape hatch for future types.** Rejected: leaves the existing 16 methods' maintenance burden (one adapter implementation each, times 3 adapters/doubles) in place for no correctness benefit, since none of them were more type-safe than a string key in practice.
- **A typed `PriceKey` union instead of a bare `string`.** Considered for the new signature. Rejected for now: the key space already has runtime-only variants (an EBS volume type the code hasn't seen before still needs a lookup, with a graceful fallback rather than a compile error) — a closed union would force either an escape hatch identical to the current `string`, or rejecting valid-but-unlisted keys outright.

## Consequences

`PricingPort` is a 2-method interface instead of 17. Adding a fixed-cost resource type now touches only `prices.json` (a new key) and the scanner (`pricing.getPrice(region, 'new-key')`) — no interface, no adapter, no `mockPricing` method to add (only a lookup-table entry). All 29 scanners were migrated to the new call shape in one pass; `mock-pricing.ts` became a `PRICES_BY_KEY` lookup table with the same prefix-based fallback scanners use. Zero references to the old 16 methods remain in `src/`; typecheck, lint and the full test suite (563 tests at the time of the change, across shared-kernel/domain/aws-adapter/application/cli) pass unchanged. `docs/en/adding-a-resource.md` Step 4 and the technical-choices/architecture docs were updated to describe the single-method contract.
