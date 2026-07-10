# ADR-0059: Presenter dispatch via an exhaustive switch on the finding, not a generic `presenterFor(kind)`

- **Status:** Accepted (2026-07-10)

## Context

`resource-presenters.ts` is correctly typed at definition (`PresenterMap = { [K in ResourceKind]: ResourcePresenter<ResourceKindMap[K]> }`), but `presenterFor(kind)` returned the type-erased default `ResourcePresenter<WastedResource>`, and all 3 formatters called `presenterFor(kind).row(finding)` / `.recommend(finding)`. Nothing at compile time verified that `kind` and `finding` actually corresponded — a decoupling bug (presenter for one kind, a finding of another passed in by mistake) would compile cleanly and crash at runtime with an unhelpful error (`Cannot read property 'sizeGb' of undefined`).

A first attempt made `presenterFor` generic (`<K extends ResourceKind>(kind: K): ResourcePresenter<ResourceKindMap[K]>`) and was verified, via a throwaway repro, **not to work**: every real call site derives `kind` from a runtime loop (`for (const kind of RESOURCE_KINDS)`) or from `finding.kind`, never a literal, so the compiler always widens `K` back to the full union — a deliberately-introduced decoupling bug in the repro still went uncaught.

## Decision

`rowFor(finding)` / `recommendFor(finding)` in `apps/cli/src/formatters/resource-presenters.ts` replace `presenterFor(kind).row(finding)` / `.recommend(finding)` at all 3 formatter call sites. Each takes a single argument — the finding itself, typed as the real discriminated union `ResourceKindMap[ResourceKind]` (obtained via `groupByKind`, which already preserves the kind↔entity correlation) — and dispatches via an exhaustive `switch (finding.kind)`, 29 one-line cases, written once and shared by all 3 formatters. There is no longer a separate (kind, finding) pair for a caller to decouple: the kind dispatched on is the finding's own.

Verified this closes the gap for real, not just in theory: TypeScript's discriminated-union narrowing on `switch (finding.kind)` only works when the switched value's static type is the actual union of concrete entity classes — not the general `WastedResource` interface. Exhaustiveness is compiler-enforced via `noImplicitReturns` and `noFallthroughCasesInSwitch` (already in `tsconfig.base.json`), not convention. `presenterFor(kind)` narrows to `Omit<ResourcePresenter, 'row' | 'recommend'>` (metadata only — title/head/colWidths, which don't depend on the entity type); calling `.row()` on it is now a compile error, confirmed by deliberately reintroducing the old call pattern and observing `tsc` reject it, then reverting.

## Alternatives Considered

- **Generic `presenterFor<K>(kind: K)`.** Rejected — verified experimentally not to close the gap (see Context above).
- **Runtime guard** (`finding.kind === kind` check inside `presenterFor`, throwing a clear error on mismatch). Shipped briefly as a first pass, then superseded once the exhaustive-switch approach was found to be both fully sound and no more invasive.
- **Exhaustive `switch(kind)` duplicated inline in each of the 3 formatters.** Rejected as disproportionate — but this concern turned out to rest on a wrong premise: only the *dispatch* needs the switch, not the row/recommend logic itself (which stays in the existing `presenters` table), so writing it once and sharing it is both sound and non-duplicative.

## Consequences

One caller (`buildQuickWins` in the PDF formatter) read findings from `summary.findings` directly instead of through `groupByKind`, losing the correlation needed for narrowing — restructured to match the other call sites. `resource-presenters.spec.ts` rewritten: the old "mismatch" test is no longer constructible by design (there's no separate kind/finding pair to decouple), replaced with a dispatch-correctness test. 65/65 cli tests pass. See `docs/code-review-2026-07-10.md` §2.
