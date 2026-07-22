# ADR-0074: Waste policies split into one file per policy

- **Status:** Accepted (2026-07-22)

## Context

`resource-waste-policies.ts` had grown to 602 lines holding all 43 `WastePolicy` subclasses, one class after another with no seam between them. An external review (`docs/todo/code-review-2026-07-22.md`) flagged this as a god-file: reviewing, blaming, or testing a single policy in isolation required scrolling past the other 42, and every new scanner (Phase 6 alone added five in one sitting) added another class to the same file, guaranteeing merge conflicts on any branch adding a scanner concurrently with another. `scanner-registry.ts` (518 lines, same "one big registration file" shape) was flagged too, but is left as-is here — it exists specifically as the single source of truth for the compile-time `assertRegistryMatchesResourceKinds()` exhaustiveness check ([ADR-0043](0043-declarative-scanner-registry.md)), so splitting it needs separate, more careful design than the mechanical move done here.

## Decision

Split `resource-waste-policies.ts` into 43 files under `libs/cloud-cost/domain/src/policies/`, one per policy, named after the entity each judges (`ebs-volume.policy.ts`, `environment-ghost.policy.ts`, …) — the same one-file-per-entity convention already used in `libs/cloud-cost/domain/src/entities/` and one-file-per-scanner in the AWS adapter. Each file imports only what its own policy needs from `./waste-policy` and its entity, rather than sharing one large import block. `domain/src/index.ts` now re-exports each policy from its own file instead of a single barrel import.

In the same pass, `Gp2UpgradePolicy` was renamed to `EbsGp2UpgradePolicy` (also flagged by the review) to match the `<Resource><State>Policy` naming pattern every other policy follows.

The consolidated spec (`resource-waste-policies.spec.ts`, testing 23 of the 43 policies — pre-existing coverage, not extended here) was renamed to `waste-policies.spec.ts` and kept as **one file**, not split to mirror the 43-way production split. `describe` blocks already isolate each policy's test cases; splitting the spec too would have doubled the size of this change for no reviewability gain the single file doesn't already provide.

## Alternatives Considered

- **Group by resource category** (compute, storage, database, …), a handful of files instead of 43. Rejected: no category grouping precedent exists anywhere else in the codebase (entities and scanners are both flat, one-per-thing) and category boundaries are already fuzzy for cross-cutting kinds like `environment-ghost`.
- **Leave it as one file, just add section-comment dividers.** Rejected: doesn't solve the actual problems raised (merge conflicts on concurrent scanner additions, no isolated blame/test per policy) — purely cosmetic.
- **One file per policy** (chosen). Mechanical, zero behavior change, and consistent with the two conventions the codebase already commits to elsewhere.

## Consequences

Adding a policy now means adding one new file instead of appending to a shared one — merge conflicts between concurrent scanner additions are structurally avoided the same way they already are for entities and scanners. 602 lines became 43 files averaging ~14 lines each. Verified via `pnpm nx run-many --target={lint,test,build} --all`: lint clean (pre-existing warnings unrelated to this change), 438+240+104+23 tests passing across all five projects, all builds green. No production behavior changed — this is a pure file-organization move plus the `EbsGp2UpgradePolicy` rename, propagated to every file that referenced the old name (`scanner-registry.ts`, `aws-gp2-upgrade.scanner.ts`, `scanner-contract.spec.ts`). Docs referencing the old single-file path (`docs/en/architecture.md`, `docs/en/testing.md`, `docs/en/adding-a-resource.md` and their `docs/it/` counterparts) were updated to point at the new per-file layout; `docs/todo/code-review-2026-07-22.md` itself is left untouched as a historical record of the pre-refactor state.
