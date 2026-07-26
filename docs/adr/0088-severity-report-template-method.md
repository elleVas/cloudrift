# ADR-0088: `SeverityReportFormatter` template method for the severity-based reports

- **Status:** Accepted (2026-07-26)

## Context

`dead-resources-report.table-formatter.ts`/`.pdf-formatter.ts` and `resource-security-report.table-formatter.ts`/`.pdf-formatter.ts` were ~90-95% identical after normalizing domain-specific names (kind lists, presenter modules, disclaimer constants, report title, "no findings" message) — same report shape: a per-kind finding list with `info`/`warning`/`critical` counts, no dollar total. A code review (`docs/todo/code-review-2026-07-25.md`) flagged the general pattern ("29 formatter files, no shared strategy") without this specific pair-level analysis; a follow-up count found the real number of duplicated files was 4 (2 table + 2 PDF), not the review's broader estimate — `waste-report.*`/`cost-comparison.*`/`cost-trend.*` are a different shape (category split + `$` total, no severity) and were never candidates for unification.

The presenter-level leaf logic (`presenterFor`/`rowFor`/`recommendFor`, one exhaustive switch per domain, see [ADR-0059](0059-presenter-dispatch-exhaustive-switch.md)) was already factored out. What remained duplicated was the *report structure itself*: the loop over kinds, the scan-warnings section, the severity-count footer (table); the summary page (metric boxes, breakdown table, top-findings list) and per-kind detail pages (PDF).

## Decision

New abstract `SeverityReportFormatter<K, G, F>` in `apps/cli/src/formatters/severity-report.formatter.ts` owns both `toTable()` and `toPdf()`. Two concrete subclasses — `DeadResourcesReportFormatter`, `ResourceSecurityReportFormatter` — each supply ~9 domain-specific members (kinds, presenter/row/recommend functions, disclaimer, report title, no-findings message, a kind→label lookup) in ~39 lines. The 4 original files become thin wrappers re-exporting the same function names/signatures, so no other file in the repo (commands, specs) needed to change.

```typescript
export abstract class SeverityReportFormatter<
  K extends string,
  G extends { kind: K; severity: Severity },
  F extends G = G,
> {
  protected abstract readonly kinds: readonly K[];
  protected abstract readonly reportTitle: string;
  protected abstract readonly noFindingsMessage: string;
  protected abstract readonly disclaimer: string;
  protected abstract kindLabel(kind: K): string;
  protected abstract groupByKind(findings: G[]): Record<K, F[]>;
  protected abstract presenterFor(kind: K): { title: string; head: string[] };
  protected abstract rowFor(finding: F): string[];
  protected abstract recommendFor(finding: F): string;

  toTable(summary: SeverityReportSummary<K, G>): string { /* shared body */ }
  async toPdf(summary: SeverityReportSummary<K, G>, meta: SeverityReportPdfMeta, outputPath: string): Promise<void> { /* shared body */ }
}
```

**Two generic parameters, not one, to avoid introducing a new cast.** `G` is the general finding interface (what `summary.findings` is actually typed as — `DeadResource`/`SecurityFinding`); `F` is the precise per-kind union (`DeadResourceKindMap[DeadResourceKind]`/`ResourceSecurityKindMap[ResourceSecurityKind]`) that `rowFor`/`recommendFor` require for ADR-0059's exhaustive-switch narrowing. The widen-then-narrow already happens once, inside each domain's own `groupByKind` (documented there as a deliberate, isolated cast) — collapsing `G`/`F` into a single type parameter here would have meant either losing that narrowing (breaking ADR-0059's guarantee) or reintroducing a cast at the call site, multiplying it instead of removing it.

## Alternatives Considered

- **Shared free function + config object**, each domain formatter calling `formatSeverityReportAsTable(summary, config)`. This is architecturally the same shape as [ADR-0044](0044-cloudwatch-idle-scanner-template-method.md)'s rejected "stateful injected collaborator" alternative, for the identical reason: the duplication is in the *lifecycle/structure* (the loop, the sections, the PDF page composition), not a leaf call — delegating that structure to a config-driven function still duplicates the calling shape, just with a different signature. Initially proposed and favored (it matches the rest of `apps/cli`'s all-functions style), until the ADR-0044 precedent was found and reconsidered; see that ADR's own rejection of the same alternative for the full reasoning.
- **Minimal: dedupe only the table formatters (56 lines each), leave the PDF formatters (245/244 lines) duplicated.** Rejected as a real option once the class was written — the PDF formatters are where the larger share of duplication actually lives (summary page, detail pages, top-findings ranking, breakdown rows), so deduping only the smaller half would have left most of the actual problem in place.
- **Force `waste-report.*` into the same base class**, on the theory that "it's still a report over findings." Rejected — different shape (category split `waste`/`optimization` plus a `$` total, no severity concept at all); same reasoning ADR-0044 used to keep `s3-no-lifecycle` out of its own template rather than bending the shape to fit an outlier.

## Consequences

605 lines across 4 files (56+56+245+244) become 454 lines across 7 files (334 base class + 39+39 subclasses + 7+7+14+14 wrappers) — a modest net reduction, but the ~90-95%-duplicated logic now exists exactly once. A third domain that ever needs this same severity-based report shape gets a ~40-line subclass instead of a ~300-line copy-paste.

This is the first class-based Template Method in `apps/cli` specifically (every other file in that layer is functions), though not the first in the codebase overall — `WastePolicy` (domain layer) and `CloudWatchIdleScanner` (infrastructure layer, ADR-0044) already use the same pattern one and two layers down. No ADR mandates a function-only style for `apps/cli`; it had simply never faced this exact shape of duplication (a shared *structure*, not just a shared leaf) before now.

Verified safe despite zero pre-existing test coverage for the table formatters' exact output (only the PDF formatters had smoke tests, see [ADR-0055](0055-pdf-formatter-smoke-test.md)): captured real table output before the refactor via a throwaway spec, regenerated it after, `diff` confirmed byte-identical, then the throwaway spec was deleted. New [`severity-report.formatter.spec.ts`](../../apps/cli/src/formatters/severity-report.formatter.spec.ts) closes the coverage gap going forward — a fixture subclass (fake kinds, no real domain dependency) exercises every branch of the shared class once (no-findings message, per-kind section ordering, scan-warnings, incomplete-total suffix, severity totals, PDF smoke checks), rather than duplicating that coverage per real domain, mirroring ADR-0055's "targeted assertions, not a layout snapshot" style. `docs/en/testing.md`/`docs/it/test.md` updated to reference this file instead of describing the two PDF formatters as independent implementations.
