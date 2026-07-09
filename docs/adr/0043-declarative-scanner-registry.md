# ADR-0043: Declarative scanner registry replaces the composition-root wall of `new Scanner(...)`

- **Status:** Accepted (2026-07-09)

## Context

`analyze-waste.composition.ts` built its scanner array as a flat list of `new Scanner(pricing, accountId, new Policy(...), windowHours)` calls, one per resource kind, growing by roughly 15 lines for every new scanner. With 29 scanners the file had become a 300+ line wall that mixed two unrelated concerns — which scanners exist, and which of them are gated behind `--live-pricing` — as two separately-maintained code blocks with no compiler link back to `ResourceKind`: forgetting to register a new kind here was a silent gap, not a build failure.

## Decision

Two declarative registries, each an array of `{ kind, create(ctx) }` entries:

```typescript
const ALWAYS_ON_SCANNERS: ScannerRegistryEntry[] = [
  { kind: 'ebs-volume', create: (ctx) => new AwsEbsVolumeScanner(ctx.pricing, ctx.accountId, new EbsVolumeWastePolicy(ctx.policyOptions)) },
  // … one entry per always-on kind
];

const LIVE_PRICING_SCANNERS: ScannerRegistryEntry[] = [
  { kind: 'ec2-underutilized', create: (ctx) => new AwsEc2UnderutilizedScanner(ctx.livePricingAdapter, ctx.accountId, new Ec2UnderutilizedPolicy(ctx.policyOptions)) },
  // … one entry per --live-pricing-gated kind
];
```

`buildScanners()` is a two-line `map`/`filter` over both registries (the second filtered in only when a live-pricing adapter is available), plus `scannerKinds` filtering unchanged. `assertRegistryMatchesResourceKinds()` runs at module load and throws if a `ResourceKind` is missing from both registries or present in more than one — a wiring mistake now fails immediately at process start, not silently at scan time.

Two registries rather than one: `LIVE_PRICING_SCANNERS` entries need `ctx.livePricingAdapter` typed as required (not `AwsPricingApiAdapter | undefined`), which a single array couldn't express without a non-null assertion at every `--live-pricing` call site.

## Alternatives Considered

- **Self-registering factories co-located in each scanner file** (the shape originally sketched during review — `export const ebsVolumeScanner: ScannerFactory = { kind, requiresLivePricing, create }` living next to `AwsEbsVolumeScanner`, composition root reduced to `registeredScanners.filter(...)`). Rejected in favor of two typed arrays in the composition root itself: it keeps `requiresLivePricing` as a structural split (two arrays) rather than a boolean flag interpreted at runtime, and avoids a barrel-import step to collect factories scattered across 29 files.

## Consequences

`analyze-waste.composition.ts` is a lookup + two short registries instead of a monolithic list; adding a scanner is one entry in one of the two arrays, and forgetting it is a startup crash, not a silent gap. New `analyze-waste.composition.spec.ts` (previously absent) covers registry/`ResourceKind` parity and the `--live-pricing` filter. No change to `AnalyzeCloudWasteUseCase`, which still only sees `WasteScannerPort[]`.
