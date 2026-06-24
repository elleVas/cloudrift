# ADR-0021: `WasteReportDto` as the future frontend's API contract

- **Status:** Accepted

## Context

Today's only presentations are terminal, PDF, JSON, and markdown — but a web frontend is a plausible future addition.

## Decision

`toWasteReportDto()` already produces a JSON-safe (no classes, no `Date`, ISO strings only), versionable structure, already exercised in production by `--json`. A future HTTP endpoint (`GET /api/waste-report`) would return exactly this DTO.

## Alternatives Considered

- **Design the DTO only for the CLI's current needs and rework it later for an API.** Rejected: the use case (`AnalyzeCloudWasteUseCase`) is already headless — it doesn't know it lives inside a CLI — so shaping the DTO API-first costs nothing extra now and avoids a breaking rework later.

## Consequences

A frontend becomes an addition (new `apps/api` composition root + a fourth presenter) rather than a refactor of the core. See `docs/en/architecture.md#frontend-readiness`.
</content>
