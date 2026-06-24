# ADR-0013: DDD + Hexagonal architecture with a plugin model

- **Status:** Accepted

## Context

cloudrift needed an architecture for a scanner-per-resource-type tool that stays testable and growable as resource types, policies, and presentations all accumulate over time.

## Decision

Layered DDD architecture (domain / application / infrastructure / CLI), with every resource type implemented as a `WasteScannerPort` plugin that a generic coordinator executes uniformly.

## Alternatives Considered

- **A single flat script per resource type, no layering.** Rejected: would tie waste-detection logic directly to AWS SDK calls, making every threshold tweak require reasoning about pagination and clients, and would need mocked AWS calls to test at all.
- **Hexagonal layers but without the plugin array** (one big `switch` on `ResourceKind` in the coordinator). Rejected: every new resource type would mean editing the coordinator itself instead of just adding a new port implementation.

## Consequences

Explicitly more structure than the bare minimum for a tool this size — justified only because policies, resource types, and presentations (terminal/PDF/JSON/markdown, maybe a frontend later) are all expected to keep growing. If none of those three directions were true, this would be over-engineered (see `docs/en/architecture.md`).
