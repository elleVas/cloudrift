# ADR-0098: `cloud-cost-pricing` extracted as a new shared package, published for `cloudrift-iac-detector`

- **Status:** Accepted (2026-07-30)

## Context

`cloudrift-iac-detector` (the separate, private Terraform drift-detector repo) is adding cost estimates to the "zombie resources" it finds (AWS resources that exist but that Terraform lost track of). It needs a `$/month` figure per resource, and per this codebase's own stance against duplicating pricing data (`prices.json` is the single verified source), it should reuse this repo's pricing engine rather than maintain its own copy.

`cloud-cost-domain` (`libs/cloud-cost/domain`) is not a small, generic "waste vocabulary" package: it holds 44 resource-kind-specific entities (`NatGateway`, `IdleEbsVolume`, ...) and 44 matching waste policies — the actual business logic behind this repo's 44 free OSS scanners. `ResourceKind` is a closed union of exactly those 44 kind strings. None of that is reusable outside this repo: `cloudrift-iac-detector`'s own zombie `kind` strings (`iam-role`, `vpc`, `security-group`, ...) mostly aren't even members of `ResourceKind`, and re-selling this repo's specific idle-detection rules behind a paywall would give a paying customer nothing beyond what the free OSS scanners already do.

What *is* generic, and had zero dependency on the 44-kind catalog once traced through:
- `PricingPort` (`getPrice(region, key)` — takes an arbitrary string key)
- `AwsRegion` / `CostEstimate` value objects
- `WastePolicy` (abstract base), `WasteVerdict`, `waste()`/`notWaste()` — except its generic bound was `T extends WastedResource`, which *would* have pulled in the 44-kind catalog
- `TablePricingAdapter`, `StaticPriceTableAdapter`, `mergePriceTables`, `prices.json`

`AwsPricingApiAdapter` (live AWS Pricing API pricing) was considered and **excluded**: of its 14 methods, only `warmUp()` produces a generic `PriceTable` (covering the same static-priceable keys as `prices.json`); the other 13 are per-instance-type on-demand lookups (`getRdsInstancePricePerMonth`, `getMskBrokerPricePerMonth`, ...) tightly coupled to this repo's own scanner needs (engine-name mappings, region→Pricing-API-location tables). `cloudrift-iac-detector`'s zombie scanners don't currently capture instance-type/volume-type at scan time anyway, so live pricing would add real complexity (credentials, rate limits, a new failure mode) without being usable yet.

`libs/shared/aws-infra-utils` (ADR-0085) already established the pattern this follows: a `scope:shared` Nx lib, internal name unscoped and `private: true`, with a `build-pkg`/`publish-pkg` pair that bundles it and republishes under a scoped `@ellevas/...` name to GitHub Packages for external private consumers — its own script's header comment already named `cloudrift-iac-detector` as the anticipated consumer.

## Decision

New Nx library `libs/shared/cloud-cost-pricing` (`scope:shared`, internal package name `cloud-cost-pricing`), structured identically to `shared-aws-infra-utils`. Moved (not copied) into it:

- `PricingPort` (from `cloud-cost-domain/src/ports/outbound/pricing.port.ts`)
- `AwsRegion`, `InvalidAwsRegionError`, `AWS_REGION_CODES` (from `cloud-cost-domain/src/value-objects/aws-region.value-object.ts`)
- `CostEstimate` (from `cloud-cost-domain/src/value-objects/cost-estimate.value-object.ts`)
- `WastePolicy`, `WasteVerdict`, `waste()`, `notWaste()`, `DEFAULT_MIN_AGE_DAYS`, `DEFAULT_IGNORE_TAG` (from `cloud-cost-domain/src/policies/waste-policy.ts`)
- `TablePricingAdapter`, `mergePriceTables`, `StaticPriceTableAdapter`, `BUILTIN_PRICE_TABLE`, `BUILTIN_PRICES_AS_OF`, `prices.json` (from `cloud-cost-infrastructure-aws-adapter/src/pricing/`)

**`WastePolicy<T extends WastedResource>` changed to `WastePolicy<T extends TaggedResource>`**, a new minimal interface (`{ readonly tags: Record<string, string> }`) declared in this package. `WastePolicy` only ever read `resource.tags`; constraining on the full `WastedResource` would have created a circular package dependency (`cloud-cost-pricing` → `cloud-cost-domain` for `WastedResource`, `cloud-cost-domain` → `cloud-cost-pricing` for `AwsRegion`/`CostEstimate`/`PricingPort`) for a field neither type needs the rest of the other for. Every existing `WastePolicy<SomeEntity>` subclass (all 44) still type-checks unchanged, since every `WastedResource` has `tags` and so still satisfies `TaggedResource` structurally.

The six original file locations in `cloud-cost-domain` and `cloud-cost-infrastructure-aws-adapter` are now one-line re-export shims pointing at `cloud-cost-pricing`, so no consumer of either package's own index.ts needed an import-path change — `cloud-cost-domain`'s and `cloud-cost-infrastructure-aws-adapter`'s public API surface is unchanged. `cloud-cost-domain` and `cloud-cost-infrastructure-aws-adapter` both gained `cloud-cost-pricing: workspace:*` as a dependency, and (same ADR-0085 gotcha) every project whose Jest config maps `cloud-cost-domain` to source (`cloud-cost-application`, `cloud-cost-infrastructure-aws-adapter`, `dead-resources-{domain,application,infrastructure/aws-adapter}`, `resource-security-{domain,application,infrastructure/aws-adapter}`, `mcp-server-application`, `apps/cli`) needed a matching `cloud-cost-pricing` `moduleNameMapper` entry added, since those packages' entities/policies transitively import the moved value objects.

`libs/shared/cloud-cost-pricing/scripts/make-publish-package.mjs` mirrors `shared-aws-infra-utils`'s script exactly, publishing as `@ellevas/cloud-cost-pricing` to `npm.pkg.github.com` — same manual `pnpm nx run cloud-cost-pricing:publish-pkg` + `npm publish` from `dist-pkg/` flow (no CI automation exists for this, matching `aws-infra-utils`).

## Alternatives Considered

- **Depend on the whole `cloud-cost-domain` + `cloud-cost-infrastructure-aws-adapter` package.** Initially the preferred option in `cloudrift-iac-detector`'s own planning, before this repo's actual contents were inspected file-by-file. Rejected once it became clear this would import all 44 waste entities/policies (this repo's specific free-tier business logic, not reusable vocabulary) and a `ResourceKind` union incompatible with the consumer's own resource-kind strings.
- **Include `AwsPricingApiAdapter` (live pricing) in the extracted package.** Rejected for now: 13 of its 14 methods are per-instance-type lookups specific to this repo's own scanner catalog, not generic; only `warmUp()` would transfer, and the consumer can add it later behind the same `PricingPort` interface without any calling-code change, once/if it captures instance-type data at scan time.
- **Fold `cloud-cost-pricing` into `shared-kernel` directly.** Rejected for the same reason ADR-0085 rejected this for `aws-infra-utils`: `shared-kernel` is domain-model plumbing (`Entity`, `ValueObject`, `Result`, `DomainError`) with no pricing-specific knowledge; a separate `scope:shared` lib keeps that boundary clean.

## Consequences

Verified via `pnpm nx run-many --target=lint,typecheck,test,build --all --parallel`: all 18 projects green, no behavior change to any of the 44 existing waste scanners or their tests (398 assertions in `cloud-cost-infrastructure-aws-adapter` alone, unchanged). New `cloud-cost-pricing` project carries its own 100%-covered test suite (52 tests), including a new `waste-policy.spec.ts` — the base class previously had no dedicated spec (exercised only transitively through the 44 concrete policies, which stay in `cloud-cost-domain`).

Same known limitation as ADR-0085: `depConstraints` (`scope:domain`/`scope:infrastructure` → `scope:shared` is permitted) don't *mandate* reuse — nothing stops a future package from duplicating these utilities again instead of depending on `cloud-cost-pricing`.

Publishing `@ellevas/cloud-cost-pricing` to GitHub Packages is a manual step (not yet run as of this ADR) — tracked separately, requires `GITHUB_PACKAGES_CLOUDRIFT_TOKEN`.
