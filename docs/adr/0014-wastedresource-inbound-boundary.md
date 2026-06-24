# ADR-0014: `WastedResource` as the sole inbound-boundary type

- **Status:** Accepted

## Context

18 concrete entities exist (`EbsVolume`, `ElasticIp`, `RdsInstance`, ...); something has to cross uniformly into application/CLI code.

## Decision

Coordinator, summary, formatters, and DTO depend only on the `WastedResource` interface, never on concrete entities. `ResourceKind` is a closed string-literal union; adding a kind fails the typecheck until every consumer is updated.

## Alternatives Considered

- **Let each formatter/consumer depend on the concrete entity types directly.** Rejected: would require N-way type-switching in every consumer instead of one shared interface, and adding a kind would mean hunting for every switch statement by hand.

## Consequences

Adding a resource kind is a compiler-guided checklist (one line in the `ResourceKind` union, then follow the type errors), not a manual search. This is "pragmatic OCP": one modification point exists, but the compiler walks you through everywhere else.
