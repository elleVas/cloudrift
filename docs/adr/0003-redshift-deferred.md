# ADR-0003: Redshift deferred out of v0.4.0

- **Status:** Accepted (2026-06-21)

## Context

v0.4.0 added 7 new waste scanners; an idle-Redshift-cluster scanner was a candidate for inclusion.

## Decision

Defer Redshift to v0.4.1. Pure sequencing — no technical blocker, and it fits the [scanner coverage criteria](0001-scanner-coverage-criteria.md) (provisioned, fixed cost at rest) just as well as the others.

## Alternatives Considered

- **Include it in v0.4.0 anyway.** Rejected to keep the phase scoped and shippable at 7 scanners.

## Consequences

Idle-Redshift-cluster detection remains a known, intentional gap until v0.4.1.
