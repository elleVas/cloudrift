# ADR-0019: Server-side filtering is an optimization only, never the decision

- **Status:** Accepted

## Context

Adapters can pass filters directly to AWS APIs (e.g. `status=available` for EBS volumes), which is faster than fetching everything and filtering client-side.

## Decision

Any such server-side filter is treated purely as a performance optimization producing a superset of candidates. The actual waste/no-waste decision always goes through the domain policy ([ADR-0016](0016-waste-rules-in-domain.md)).

## Alternatives Considered

- **Trust the API filter as the final answer when it looks precise enough.** Rejected: would silently reintroduce business logic into the adapter layer — exactly what ADR-0016 is meant to avoid.

## Consequences

Adapters can be tuned for API call efficiency without ever risking a policy regression; the policy is always re-evaluated against whatever the filter returns.
