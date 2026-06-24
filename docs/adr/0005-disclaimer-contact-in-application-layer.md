# ADR-0005: Disclaimer/contact centralized in the application layer

- **Status:** Accepted (2026-06-22)

## Context

Every output format (markdown, PDF, JSON) needs the same legal disclaimer (read-only tool, no liability, validate with your infra team) and contact info, with a single source of truth.

## Decision

Put `REPORT_DISCLAIMER` and `REPORT_CONTACT` in `libs/cloud-cost/application/src/constants/report-disclaimer.ts`, not in `apps/cli`.

## Alternatives Considered

- **Define it in `apps/cli` and pass it down through formatters.** Rejected: `WasteReportDto` is built in `application`, and a CLI-layer constant would have to flow against the dependency direction (dependencies point inward toward the domain, not outward to the CLI).
- **Duplicate the strings per formatter.** Rejected: guarantees drift between markdown/PDF/JSON wording over time.

## Consequences

One constant feeds the markdown footer, the PDF summary page, and the DTO's top-level `disclaimer`/`contact` fields (see [ADR-0006](0006-dto-disclaimer-contact-top-level.md)). Changing the wording or contact details is a one-file change.
