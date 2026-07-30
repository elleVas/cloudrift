# ADR-0100: `history --compare` and `history --html` — scan-to-scan comparison and an inline-SVG trend report

- **Status:** Accepted (2026-07-30)

## Context

ADR-0099 built the write path and a plain list view for the local trend store. The next ask was to make that history actually useful to look at: "how much was I spending N scans ago vs. now?" and "how much has cloudrift saved me over time?" — plus a visual, chartable view of the same data.

The second question is genuinely hard to answer honestly: cloudrift is read-only and never remediates anything (see the project's own disclaimer), so it has no way to know *why* a finding disappeared between two runs — the user fixed it, the resource was deleted for an unrelated reason, or it simply fell outside this run's `--regions`/`--scanners` selection. Any "savings" figure has to be presented as an inference, not a confirmed number.

## Decision

**`history --compare <n>`**: diffs the latest snapshot against the one `n` runs back, for one domain at a time (`--domain` required — the three domains have incompatible report shapes). New module `apps/cli/src/commands/history-comparison.ts`:

- `compareCloudCostSnapshots(older, newer)` — the `$/month` domain. Reports `deltaUsd`/`deltaPercent` (null when the older total was $0), and a `presumedResolvedMonthlyUsd` figure: the sum of `monthlyCostUsd` for findings present in the older snapshot but absent from the newer one. Labeled "presumed" everywhere it's shown (CLI table, JSON, HTML) — this is this ADR's answer to the "how much have I saved" ask, framed as an estimate per this project's existing "Honest caveat" convention, not a confirmed number.
- `compareHygieneSnapshots(domain, older, newer)` — `dead-resources`/`resource-security`, which have no dollar figure, only severity counts. Both functions also report `newFindings` (waste/risk that appeared since the older run) and a `regionsChanged` flag (the two runs scanned different region sets — a resolved/new finding may just reflect that, not real change).
- `compareHygieneSnapshots`'s `older`/`newer` parameters share **one generic type parameter** (`<T extends HygieneReportLike>`), not a union of the two DTOs. A union parameter made `older.findings`/`newer.findings` two independently-unioned array types, which fails to type-check when passed into the shared `diffFindingsById<T>` helper (TypeScript can't infer a single `T` for `readonly T[]` from two unrelated array-type unions) — and, more importantly, a union parameter would have silently allowed comparing a `dead-resources` snapshot against a `resource-security` one, which is never a valid comparison. The call site (`history.command.ts`'s `buildComparison`) switches on `domain` and casts to the concrete DTO in each branch, so `T` is always inferred as one concrete type.

**`history --html [filename]`**: writes a self-contained HTML report (`apps/cli/src/formatters/history-report.html-formatter.ts`) — one domain's metric (`totalWasteMonthlyUsd` for `cloud-cost`, total finding count for the hygiene domains) charted as a line over every stored run, plus its table-view twin. Additive, same convention as `--pdf`/`--csv` elsewhere (never replaces stdout).

**Chart implementation: hand-rolled inline SVG, zero chart-library dependency** — not a vendored/bundled charting library, not a CDN script. Same reasoning ADR-0099 used for choosing `node:sqlite` over `better-sqlite3`, and the original reasoning for choosing `pdfkit` over a headless browser: this project avoids heavy dependencies and keeps every report fully offline, consistent with "your data never leaves your machine." A CDN-hosted library was explicitly rejected: opening the report would require internet access and load remote script, in tension with that same positioning. The mark specs (2px line, ~10% opacity area wash, 8px+ end-dot with a 2px surface ring, hairline gridlines, single-hue blue, no legend for the single series) and the hover crosshair+tooltip (vanilla JS, `textContent` only — never `innerHTML` — for inserting date/value strings) follow this project's dataviz conventions. Dark mode is `prefers-color-scheme` only (no `data-theme` toggle scope): this is a static file a user opens directly in their own browser, not a hosted page with a theme switcher.

## Alternatives Considered

- **A union parameter type for `compareHygieneSnapshots`** (`older: DeadResourcesReportDto | ResourceSecurityReportDto`) — the first draft, rejected once it failed to type-check (see above) and once it became clear it would also silently permit an invalid cross-domain comparison.
- **A vendored/bundled charting library inline in the HTML.** More interactivity (zoom, richer tooltips) out of the box, still fully offline — but a new dependency to track/update, and unjustified for a single-series line chart. Left as a fallback option if richer interaction is ever needed.
- **CDN-hosted charting library.** Rejected outright: breaks offline use and the "data never leaves your machine" positioning.
- **Always computing "presumed resolved" regardless of region match.** Rejected in favor of surfacing `regionsChanged` as an explicit caveat — a silent number would overstate confidence in an inference that already can't distinguish "fixed" from "out of scope this run."

## Consequences

`shared-trend-store` is unchanged — both features are pure `apps/cli` additions consuming the DTOs it already stores. `history.command.ts`'s `HistoryDeps` gained `writeHtmlReport` as an injectable seam specifically so its own tests never touch the real filesystem, mirroring why the three scan commands' specs `jest.mock('shared-trend-store')` (ADR-0099) rather than exercise the real SQLite file.

Verified via `pnpm nx run-many --target=lint,typecheck,test,build --projects=cli,shared-trend-store`: 278 tests green. Also verified end-to-end against a seeded SQLite file through the actual packaged CLI (not just `nx build`): `history --compare` renders the expected delta/presumed-resolved figures, and `--html` produces a report with one `<circle>` per snapshot and one table row per snapshot.

Not yet built: a way to compare by a date range instead of "N runs back," and no CSV export for the comparison view (table/JSON only, matching the plain list view's own format set).
