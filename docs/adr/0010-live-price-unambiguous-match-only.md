# ADR-0010: Live price accepted only on unambiguous filter match

- **Status:** Accepted

## Context

AWS Pricing API filters can resolve to multiple SKUs for the same logical resource.

## Decision

Accept a live price only if the filter resolves to **exactly one value**; otherwise fall back to the static price ([ADR-0009](0009-three-pricing-layers.md)).

## Alternatives Considered

- **Pick the first/cheapest/median match when ambiguous.** Rejected: silently reporting a guessed price is worse for trust in the report than falling back to a known-but-explicit static number.

## Consequences

Live pricing is conservative by design — some prices stay on the static table even with `--live-pricing` enabled, and that's intentional, not a bug.
</content>
