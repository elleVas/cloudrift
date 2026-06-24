# ADR-0033: No dependency injection framework

- **Status:** Accepted

## Context

The object graph (pricing, policies, scanners → use case) is currently flat: the composition root instantiates everything and passes it down once.

## Decision

Manual constructor injection. `analyze-waste.composition.ts` is the single composition root, called by `analyze-waste.command.ts` through the injectable `AnalyzeDeps.createAnalysis` seam — the same seam `analyze-waste.command.spec.ts` fakes to test without AWS. The plugin model (`WasteScannerPort[]`) is the only "registry" needed.

## Alternatives Considered

- **InversifyJS or tsyringe.** Rejected: would require `emitDecoratorMetadata` and container configuration for a graph that a single composition function already handles cleanly; no concrete benefit found at this scale.

## Consequences

Revisit only if the graph stops being flat — e.g. if conditional/lazy wiring grows significantly beyond the current `--live-pricing` scanner-gating ([ADR-0011](0011-live-pricing-gated-scanners.md)).
