# ADR-0067: SaaS readiness — architectural hints for recurring scans

- **Status:** Accepted (2026-07-14)

## Context

Phase 6's vertical scanners are aimed at higher-budget segments (Kubernetes/ML/data platform teams) who are also the most likely audience for a recurring, hosted version of cloudrift (scheduled scans, historical trend, a dashboard) rather than a one-off CLI run. No such SaaS product is being built now, and none is scoped in this phase's task list ([`docs/todo/piano-scanner-verticali.md`](../todo/piano-scanner-verticali.md)) — but it's worth recording, while the vertical scanners are fresh, which existing architectural choices already leave that door open and which don't, so a future decision to build it isn't blocked by avoidable rework.

## Decision

This ADR documents observations only. No code changes accompany it.

- `WasteReportDto` ([ADR-0021](0021-wastereportdto-frontend-contract.md)) is already a plain JSON-serializable contract — persistable as-is to DynamoDB/S3 keyed by `{accountId, timestamp}` for scan history, without a schema migration.
- `FindWastedResourcesUseCasePort` is decoupled from the CLI adapter — an orchestrator (e.g. a Lambda triggered by EventBridge on a schedule) could call the same use case a future HTTP/Lambda adapter would use, mirroring how the CLI adapter calls it today.
- `analyze-waste.composition.ts`'s registry-based scanner wiring ([ADR-0043](0043-declarative-scanner-registry.md)) is an isolated factory, already free of CLI-specific concerns (`process.argv`, stdout formatting) — reusable from a non-CLI entry point without extraction work.
- `ResourceKind` plus the existing `--live-pricing` gate is a natural, already-drawn line for a future pricing tier (e.g. free tier = always-on scanners, paid tier = live-pricing-gated scanners including the new SageMaker/EKS ones) — not a mechanism to build now, just a boundary that already exists and happens to line up.
- A recurring-scan flow, if built, would look like: EventBridge Rule (schedule) → Lambda (runs the existing use case) → S3 (report + history) → SNS/email (notification) → a later dashboard reading history via API Gateway → Lambda. This is a sketch for future reference, not a design that's been reviewed or committed to.

## Alternatives Considered

Not applicable — this ADR records observations about existing architecture, it does not choose between implementation alternatives for a system that doesn't exist yet.

## Consequences

- No code, dependency, or test changes result from this ADR.
- If a SaaS/recurring-scan direction is picked up later, this ADR is the starting reference point — but it is not a commitment, timeline, or design; a real implementation would need its own ADR(s) once actually scoped (consistent with [ADR-0007](0007-no-release-until-requested.md)'s "nothing ships until explicitly requested" posture applied more broadly to unscoped future work).
