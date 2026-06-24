# ADR-0016: Waste rules live in the domain, not in AWS API filters

- **Status:** Accepted

## Context

It's tempting to express "what counts as waste" directly as filters on AWS API calls (e.g. only fetch EC2 instances with `state=stopped`).

## Decision

Every waste rule is an explicit `WastePolicy<T>` in `domain/src/policies/`, evaluated after the adapter fetches data. The AWS API filter, if any, is allowed to return a superset of candidates — never the final word (see [ADR-0019](0019-server-side-filter-optimization-only.md)).

## Alternatives Considered

- **Express all rules as API query filters where possible.** Rejected: ties the product's actual intellectual property (the definition of waste — grace periods, exclusion tags, AMI-bound snapshots) to AWS API capabilities, and makes it untestable without mocking AWS calls.

## Consequences

Domain rules are pure functions, tested with fake dates/entities and no AWS mocking. Adapters may still pre-filter server-side purely as a performance optimization.
</content>
