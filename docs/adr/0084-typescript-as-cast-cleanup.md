# ADR-0084: TypeScript `as` cast cleanup — mechanical fixes, deferred fallback decisions, legitimate exceptions

- **Status:** Accepted (2026-07-25)

## Context

A codebase-wide review of non-`as const` type assertions applied one heuristic throughout: a cast is only justified when the compiler genuinely cannot derive the information another way (a runtime boundary the type system can't see across, or an SDK/library type that's structurally accurate but incomplete); if the same fact is checked at runtime a few lines away via a plain boolean callback, that's a signal a type predicate should replace the cast instead. ~238 non-`as const` casts existed across production code (excluding tests).

This was done in two passes. The first pass (same week) covered `AwsAdapterError`'s `err as Error` pattern (66 sites across 4 domains), two IAM access-key casts, and `paginate()`'s generic default in three domains (71 casts total) — straightforward because the fix was the same shape each time (widen a constructor parameter, or split a generic default into two overloads).

The second pass (this ADR) re-swept the codebase for everything the first pass didn't touch, since the original count only ever covered those three patterns. It surfaced 19 more casts fixable the same mechanical way, 3 that need a product decision before they can be fixed (not a type-only change), and confirmed 11 more as genuinely unfixable — each verified in isolation against `tsc --strict` before being touched, not assumed from a resemblance to an already-accepted case.

## Decision

**Fixed (19 casts, zero behavior change, each verified to compile without the cast before being applied):**

- `shared-kernel`'s `ValueObject.equals()`/`Entity.deepFreeze()` (4 casts): replaced with an `isRecord` type predicate, or switched from `Object.keys(x as object)` + indexed access to `Object.values(x)` (which needs no cast at all on a generic type parameter narrowed to `object`).
- Three `--scanners` CLI validators (`resolve-options.ts`, `dead-resources.command.ts`, `resource-security.command.ts`): each already validated every element against a `Set` via a plain `.filter()` callback, then cast the whole array past that check. Replaced with a named `isXKind` type predicate used through `Array.prototype.every`, which TS does narrow the array's element type on.
- Five CLI commands' `(options.format ?? 'table') as OutputFormat`: same shape — cast *before* the `OUTPUT_FORMATS.includes(format)` check that validates it two lines later. Replaced with an `isOutputFormat` type predicate used for that same check, so the narrowing and the validation are the same line instead of a cast the validation never feeds back into.
- `static-price-table.adapter.ts`: the `.filter()` that separates real per-region price tables from `prices.json`'s metadata fields (`_comment`, `pricesAsOf`) used a plain boolean callback then cast the result; replaced with an `isRegionPricesEntry` type predicate (one of the two casts here; see Alternatives Considered for why the other one stays).
- `brand-mark.ts`: `renderCell` cast `bottom` past a `null` check that was only proven by *not* being the two other early-return branches; reordered the three branches so each checks the variable it uses directly, which needs no cast for any of them. Separately, `new Array(n).fill(x) as string[]` → `new Array<string>(n).fill(x)` (the generic overload of the `Array` constructor already returns the right type).
- `cost-explorer-cache.adapter.ts`: `JSON.parse(raw) as CostPeriodBucket[]` was a fully redundant cast — `JSON.parse` already returns `any`, which needs no cast to satisfy any return type. Removed; this does not add or remove any validation of the cache file's contents.
- `aws-ec2-instance.scanner.ts`: `(inst.State?.Name ?? 'stopped') as Ec2InstanceState` — verified that the SDK's `InstanceStateName` union and the domain's `Ec2InstanceState` union have exactly the same members, and `'stopped'` (the fallback) is already one of them, so the fallback expression's inferred type already equals `Ec2InstanceState` with no cast needed.

**Deferred — needs a product decision, not a type-only fix (3 casts, left in place with a comment explaining why):**

- `aws-ebs-volume.scanner.ts`'s `v.State as EbsVolumeState` and `aws-load-balancer.scanner.ts`'s `lb.Type as LoadBalancerType`: both SDK unions are exactly identical in membership to their domain counterparts, but the SDK field is optional and neither site has a fallback for the `undefined` case (unlike `aws-ec2-instance`/`aws-rds-instance`, which use `?? 'stopped'`). Removing the cast safely requires picking a placeholder value for "AWS omitted the state/type of a resource that unambiguously exists" — a product choice about what that resource should then look like in a report, not something a cast-removal pass should decide unilaterally.
- `aws-rds-instance.scanner.ts`'s `(db.DBInstanceStatus ?? 'stopped') as RdsInstanceStatus`: RDS is the one service here where the SDK types the field as an open `string`, not a closed union — AWS documents RDS instance statuses as free-form. A real type guard would need to enumerate every status `RdsInstanceStatus` is meant to cover *and* decide what happens for a real AWS status outside that list (today: silently relabeled via the `stopped` fallback). Both are behavior decisions.

**Confirmed legitimate, left as-is (11 casts, each now commented in place with why):**

- 4× `Option<Value>[]` casts across the wizard files (`scanner-selection`, `dead-resource-selection`, `resource-security-selection`, `region-input`): `@clack/prompts`' `Option<Value>` is a conditional type that distributes over a union `Value`, so `.map()` producing one object shape can't be correlated per-element with its own literal's variant. Confirmed via `tsc`: no restructuring of the `.map()` call avoids this.
- 4× `normalizedCause as Error & { $metadata?; code? }` in the four `AwsAdapterError` classes (one per domain, ADR-0078 duplication): the AWS SDK attaches these fields to thrown errors only at runtime; its own public `Error` type doesn't declare them.
- `groupByKind()`'s two casts, duplicated per domain (`cloud-cost`, `dead-resources`, `resource-security`), plus the same pattern newly found in `waste-report.dto.ts` and `wasted-resource.ts`: `Object.keys`/`Object.fromEntries` always return the widened `string`-keyed shape, discarding the fact that the keys/entries were built from an exhaustive `RESOURCE_KINDS`-style list. All now cross-reference each other in comments instead of independently re-deriving the same justification.
- `aws-pricing-api.adapter.ts`'s `JSON.parse(item as string)`: the AWS Pricing API returns some `PriceList` entries as a boxed `String` object (not a primitive), which `JSON.parse`'s signature doesn't accept even though it works fine at runtime — already commented before this ADR.
- `static-price-table.adapter.ts`'s `priceTable as Record<string, unknown>` (the other half of the `.filter()` fix above): `prices.json`'s inferred type has fixed, heterogeneous keys rather than a string index signature, so `Object.entries` needs the widened view to iterate it generically before the (now real) type predicate filters it back down.

## Alternatives Considered

- **Fixing all 3 deferred casts by picking a fallback now** (e.g. `v.State ?? 'available'`, `lb.Type ?? 'application'`, a `RdsInstanceStatus` guard defaulting unmapped statuses to `'stopped'`). Rejected for this ADR: each choice silently relabels a resource AWS returned incomplete/unrecognized data for, which changes what a report shows for that resource — worth a deliberate choice, not a side effect of a cast-cleanup pass.
- **A runtime schema validator (`zod`) for the JSON-sourced casts** (`prices.json`, the Cost Explorer disk cache). Rejected, same reasoning as ADR-0051: both are effectively self-controlled data (`prices.json` is committed and reviewed; the cache is written by this same code and never touched externally), so a full schema layer would validate structure already guaranteed by the code that produced it.
- **Leaving the `Option<Value>[]` casts uncommented since only one file explained the pattern.** Rejected — the other three wizard files had the identical construct with no explanation, which reads as an oversight rather than a deliberate exception on inspection; now all four cross-reference the same reasoning.

## Consequences

Of the ~34 non-`as const` casts found beyond the first pass's 71, 19 are gone (verified individually against `tsc --strict` before being applied, then confirmed with a full `nx run-many --target=build/test/lint --all` — 1327 tests, 0 lint errors), 3 remain with an explicit comment naming the exact decision blocking their removal, and 11 remain with a comment establishing why no further reduction is possible without moving the problem elsewhere. A grep for `type \w+ as \w+` (import aliases) and the literal string `" as "` inside string/template literals will keep surfacing false positives in any future cast audit — neither is an assertion.
