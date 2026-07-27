# ADR-0093: Quick-wins ranked by savings/effort, category bar chart in the waste PDF

- **Status:** Accepted (2026-07-27)

## Context

A pasted external code review flagged the waste PDF as "a report, not a consulting one-pager": the "Top recommendations" list was sorted by raw monthly cost only (no sense of how hard a fix is), and the category breakdown was a text table with no visual. Verifying the review against the actual code showed most of its other claims were already addressed or stale (see the triage kept in project memory), but these two were real: `buildQuickWins()` in `waste-report.pdf-formatter.ts` sorted strictly by `monthlyCostUsd`, and `drawSummaryPage()`'s "Waste breakdown by resource type" section was table-only.

## Decision

**Per-kind `effort: 'low' | 'medium' | 'high'`** added to `ResourceKindMeta` (`libs/cloud-cost/domain/src/wasted-resource.ts`), classified for all 44 `ResourceKind`s using an explicit three-tier criterion (pure delete/detach with no dependents = low; needs verification or an in-place config change with a secondary effect = medium; needs downtime, migration, or cross-team coordination = high) — see `docs/en/remediation-effort.md`/`docs/it/livello-sforzo.md` for the full per-kind table and rationale, which the user reviewed and approved before it was wired into code. `effortOf(kind)` is the accessor, mirroring `categoryOf()`/`isEstimated()`.

**Quick-wins re-ranked by a cost/effort score, not raw cost.** `buildQuickWins()` now sorts by `monthlyCostUsd / EFFORT_WEIGHT[effort]` descending (`EFFORT_WEIGHT = { low: 1, medium: 2, high: 3 }`), so a cheap-to-fix medium-cost finding can outrank an expensive one that needs a maintenance window. Each recommendation row in the PDF gained a color-coded effort badge (`LOW`/`MED`/`HIGH`, green/amber/red via a new `C.success` in the shared PDF palette) between the label and the monthly-cost column. The section heading changed from "Top recommendations — sorted by monthly impact" to "Top quick wins — savings vs. remediation effort" to match.

**Category breakdown gets a bar chart, drawn with native pdfkit rectangles — additive, not a replacement for the table.** `buildCategoryChartRows()`/`drawBarChart()` render the top 6 waste kinds by monthly cost as horizontal bars (`C.primary`, proportional width, `$X/mo` right-aligned) directly above the existing "Waste breakdown by resource type" table. The table is untouched — same headers, same full kind list, same numbers — so nothing already on the summary page is lost; the chart is a five-second skim layer on top of it.

## Alternatives Considered

- **Pie chart per category** (the review's literal suggestion, and the option originally on the table). Rejected in favor of a bar chart: a pie chart needs manual arc/wedge trigonometry and label-collision handling in pdfkit (no chart primitives beyond paths/rects), and becomes illegible past 5-6 slices — exactly the range this report regularly hits once several scanners fire. A bar chart uses only rectangles, degrades gracefully at any row count, and needed a fraction of the code.
- **Chart rendered as an image via a charting library** (e.g. `chartjs-node-canvas`) embedded with `doc.image()`. Rejected: adds a dependency with native canvas bindings — a platform-specific install for every npm consumer of `@cloudrift/cli` — to draw six rectangles, which the project's existing no-unnecessary-dependency convention (see the CSV-formatter [ADR-0092](0092-csv-output-format.md), the debug logger [ADR-0047](0047-minimal-namespaced-debug-logger.md)) already argues against.
- **Replacing the breakdown table with the chart** instead of adding the chart alongside it. Rejected: the table is the only place on the summary page carrying the exact `Found`/`$` figures for every kind (the chart caps at 6, sorted by cost); dropping it would regress information a reader might specifically want to `Ctrl+F` or quote verbatim.
- **Deriving "effort" from existing fields** (`category`, `estimated`) instead of adding a new one. Rejected in the options discussion: neither field measures effort — `category` is waste-vs-optimization, `estimated` is pricing-confidence — reusing them would silently misrepresent what "effort" means.
- **Keep $-only ranking, just label the effort tier without re-sorting** (the more conservative of the two options presented to the user). Not chosen: the user picked the full re-ranked version as the "final result" directly, skipping the incremental step.

## Consequences

`RemediationEffort` is exported from `cloud-cost-domain`'s public index alongside `ResourceKindMeta`. `docs/en/remediation-effort.md` / `docs/it/livello-sforzo.md` are the source of truth for *why* each kind has the rating it does — update them first if a rating changes, the code comment in `wasted-resource.ts` points there rather than repeating the rationale inline. Any new `ResourceKind` added in the future (see `docs/en/adding-a-resource.md`) must set `effort` on `RESOURCE_KIND_META` or the object literal fails to type-check against `Record<ResourceKind, ResourceKindMeta>` — the same exhaustiveness guarantee `category`/`estimated` already had.
