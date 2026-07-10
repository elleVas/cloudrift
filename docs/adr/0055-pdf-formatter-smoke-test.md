# ADR-0055: PDF formatter gets a full-coverage smoke test, not a layout snapshot

- **Status:** Accepted (2026-07-10)

## Context

`waste-report.pdf-formatter.ts` (~350 lines of imperative PDFKit drawing: absolute coordinates, magic numbers) had zero automated tests. A PDF isn't readable by a normal assertion — nobody had written a test that even confirms `generateWasteReportPdf` completes without throwing across all 29 `ResourceKind`s. A broken presenter cast (see ADR-0059) would only surface the first time a real scan happened to include that specific resource kind.

## Decision

New `apps/cli/src/formatters/waste-report.pdf-formatter.spec.ts`: one finding per `ResourceKind` (31 findings — two kinds get a second finding each, to also exercise multi-row wrapping within a section), plus a `scanErrors` case and an empty-summary case. Asserts the returned promise resolves, the written file starts with the `%PDF-` header, and has a plausible size — not a layout snapshot. No reusable fixture builder existed anywhere in the repo (checked first), so each of the 29 entities is hand-built with realistic props.

## Alternatives Considered

- **Snapshot-testing the PDF buffer.** Rejected (also called out as optional in the original review): brittle against any PDFKit version bump or font-metric change, and doesn't test anything a human wouldn't verify visually anyway — the actual risk here is a crash, not a pixel-perfect layout regression.
- **A shared fixture builder for `WastedResource` entities.** Rejected for this task: no such builder existed, and building one generically for 29 heterogeneous entity shapes was a bigger investment than the test itself needed; the hand-built findings are used nowhere else.

## Consequences

`totalWasteMonthlyUsd`/`totalOptimizationMonthlyUsd` are computed programmatically from `RESOURCE_KIND_META[kind].category`, not hand-summed, so the test stays correct if fixture costs change. 60/60 cli tests passed at the time this landed (now 65/65 after later changes in the same review pass — see `docs/code-review-2026-07-10.md` §3).
