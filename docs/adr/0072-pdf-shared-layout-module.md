# ADR-0072: Shared PDF layout module across all three reports; table cells never truncated

- **Status:** Accepted (2026-07-22)

## Context

`waste-report.pdf-formatter.ts` was the only PDF this codebase generated, so its masthead, footer, metric boxes and table-drawing routines lived inline in that one file. Adding `cost`/`trend` PDF output ([ADR-0069](0069-cost-explorer-integration-billed-api-confirmation.md)) meant either duplicating ~200 lines of `pdfkit` boilerplate twice more, or extracting it once.

Separately, real usage surfaced two rendering bugs in the existing waste-report table: (1) long cell content (a Lambda function name suffixed `(deleted)`, a full CloudWatch log-group path) was silently cut with an ellipsis, losing information the report exists to convey; (2) column widths came from a fixed, hand-tuned ratio per resource kind that had no way to anticipate real data like a 70-character log-group path, so text overflowed into the row below even when the table nominally "fit."

## Decision

**New shared module** `apps/cli/src/formatters/pdf-shared.ts`, extracted out of `waste-report.pdf-formatter.ts`: masthead (`drawMasthead`, now with the real embedded cloudrift logo — see [ADR-0073](0073-brand-mark-pixel-art-pipeline.md) — instead of text-only chrome), footer (`drawFooter`, disclaimer + contact links), metric boxes (`drawMetricBox`), and the full table-drawing pipeline (`computeColumnWidths`, `wrapToLines`, `drawTable`, pagination via `ensureSpace`/`measureTableHeight`). `cost-comparison.pdf-formatter.ts` and `cost-trend.pdf-formatter.ts` both build on this module rather than reimplementing it, so all three reports stay visually consistent by construction, not by convention.

**Two rendering behaviors changed as part of the extraction, now shared by all three reports:**

- **No cell is ever truncated.** `wrapToLines()` has no default line cap — a cell grows to however many lines its content needs, and `rowHeightForLines()` sizes the row to match. A single space-delimited token wider than the column on its own (routine for ARNs/log-group paths, which have `/` and `-` but no spaces) is character-split by `hardBreak()` so what gets measured always matches what `pdfkit` actually renders — previously the measurement and the render could disagree, spilling an unmeasured extra line into the row below. An explicit finite `maxLines` remains available for the rare case that genuinely wants a hard cap with an ellipsis fallback, but nothing in the current formatters passes one.
- **Column widths are sized from actual content, not a fixed ratio.** `computeColumnWidths()` measures the header and every row's cell at render-time font/size, giving each column exactly what it needs; if the total exceeds the page width, `shrinkWidestFirst()` takes space only from the currently-widest column(s) — usually the free-text one, which absorbs extra wrapped lines cleanly — before ever touching a narrow structured column (a date, "us-east-1") that only has an ugly mid-word break available.

## Alternatives Considered

- **Duplicate the masthead/footer/table code into each new PDF formatter.** Rejected: three copies of the same ~200 lines, certain to drift (a footer fix applied to one and not the others) — exactly the kind of duplication the project's existing formatter-registry pattern ([ADR-0059](0059-presenter-dispatch-exhaustive-switch.md)) already avoids elsewhere.
- **Keep the ellipsis truncation, just fix the column-width bug.** Rejected: the two bugs share one root cause (the layout not adapting to real content) and the user's actual complaint was lost information ("Function (deleted)", full recommendation text cut off) — fixing widths alone would still truncate a cell whose content is inherently too long for any reasonable column, which is precisely the case real AWS identifiers produce.
- **Cap cell height by page-fraction instead of removing the cap entirely.** Rejected: reintroduces the same class of bug under different pressure (a resource with an unusually long name/reason still loses data) for no real benefit — `pdfkit`'s stream-based, unbuffered page model ([technical-choices.md](../en/technical-choices.md#pdfkit-for-the-pdf-report)) already tolerates PDFs that grow to many pages with no memory cost.

## Consequences

Any future PDF report formatter should build on `pdf-shared.ts` rather than writing its own masthead/footer/table code. A table row can now be taller than before for resources with long identifiers — expected and correct, not a regression; page counts for reports with long AWS identifiers will grow slightly, trading page count for completeness. `docs/en/technical-choices.md`'s prior claim that overflow is handled by "truncat[ing] with an ellipsis" is now stale and updated alongside this ADR.
