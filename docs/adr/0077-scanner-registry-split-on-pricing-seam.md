# ADR-0077: Scanner registry split on the always-on/live-pricing seam

- **Status:** Accepted (2026-07-23)

## Context

`scanner-registry.ts` had grown to 518 lines: two arrays (`ALWAYS_ON_SCANNERS`, 30 entries, and `LIVE_PRICING_SCANNERS`, 13 entries) each mapping a `ResourceKind` to a `create(ctx)` factory, plus the compile-time exhaustiveness check (`assertRegistryMatchesResourceKinds()`, [ADR-0043](0043-declarative-scanner-registry.md)) and `buildScanners()`. An external review (`docs/todo/code-review-2026-07-22.md`) flagged this alongside the policies god-file fixed in [ADR-0074](0074-waste-policies-one-file-per-policy.md), but that ADR deliberately left this file untouched: it's the single source of truth `assertRegistryMatchesResourceKinds()` checks against, so a naive split risked breaking that invariant, and needed its own design pass instead of the same mechanical move.

## Decision

Split `scanner-registry.ts` along the seam that already exists structurally in the code — the always-on/live-pricing distinction (`ScannerBuildContext` vs `LivePricingScannerBuildContext`, gated on `--live-pricing`) — into two new files:

- `always-on-scanners.ts` — the 30-entry `ALWAYS_ON_SCANNERS` array and its own import list.
- `live-pricing-scanners.ts` — the 13-entry `LIVE_PRICING_SCANNERS` array and its own import list.

`scanner-registry.ts` becomes the orchestrator: it keeps `ScannerBuildContext`, `LivePricingScannerBuildContext`, `ScannerRegistration<Ctx>`, `assertRegistryMatchesResourceKinds()`, and `buildScanners()`, importing the two arrays and re-exporting them so external consumers (`analyze-waste.composition.ts`, `scanner-registry.spec.ts`) don't need to change their import path. The two split files import `ScannerBuildContext`/`LivePricingScannerBuildContext`/`ScannerRegistration` back from `./scanner-registry` as type-only imports — erased at compile time, so this isn't a runtime circular dependency, only a type-level one TypeScript resolves without issue.

## Alternatives Considered

- **One file per scanner, mirroring ADR-0074's one-file-per-policy split** (43 files under a `registrations/` folder). Rejected: each policy in ADR-0074 is a full class with business logic, earning its own file. Each registration here is 3-10 lines of pure wiring (`kind` → factory call) — 43 files for that much content is navigation overhead disproportionate to what's in them, and cuts against this codebase's stance on avoiding premature abstraction.
- **Thematic grouping by domain vertical** (compute, storage, database, networking, serverless, ml, k8s — ~8 files). Rejected: requires inventing and maintaining a new classification with real boundary calls (is `eni-orphaned` networking or compute? is `eks-orphan-pvc` k8s or storage?) for every future scanner, just to solve a file-length problem the existing always-on/live-pricing seam already solves for free.
- **Split on the always-on/live-pricing seam** (chosen). Zero new taxonomy — it's the distinction the code already encodes in two separate types and a CLI flag. Purely mechanical, and keeps the exhaustiveness check's single source of truth intact in the orchestrator file.

## Consequences

`scanner-registry.ts` dropped from 518 to ~60 lines (types + the exhaustiveness check + `buildScanners`). `always-on-scanners.ts` and `live-pricing-scanners.ts` are each self-contained with their own import list, so adding a new always-on or live-pricing scanner touches one file instead of the shared 518-line one — reduces (but, unlike the 43-way policy split, doesn't eliminate) merge-conflict surface between concurrent scanner additions on the same side of the seam. No production behavior changed and no public import path changed: `ALWAYS_ON_SCANNERS`, `LIVE_PRICING_SCANNERS`, and `buildScanners` are still importable from `./scanner-registry`. Verified via `pnpm nx run-many --target={lint,test,build} --projects=cli`: lint clean, all 105 CLI tests passing (including `scanner-registry.spec.ts`'s exhaustiveness check, unchanged), build green. Docs referencing the registry file layout (`docs/en/architecture.md`, `docs/en/adding-a-resource.md` and their `docs/it/` counterparts) updated to describe the split; these docs also had a pre-existing inaccuracy — they named the file `analyze-waste.composition.ts` (the file that *imports* the registry) instead of `scanner-registry.ts` — corrected in the same pass.
