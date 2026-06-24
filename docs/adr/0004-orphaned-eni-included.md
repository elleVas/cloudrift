# ADR-0004: Orphaned ENI scanner included despite ~$0 savings

- **Status:** Accepted (Phase 4.1, v0.4.0)

## Context

Free-floating ENIs (`Status=available`, not attached to any instance) usually cost $0 directly — there's no AWS line-item for an unattached network interface.

## Decision

Scan for them anyway (`eni-orphaned`), as a hygiene finding (`FindingCategory` keeps it outside the waste total — see [ADR-0015](0015-findingcategory-waste-vs-optimization.md)), not a savings claim.

## Alternatives Considered

- **Skip ENI scanning entirely**, since it adds an entity/policy/scanner for marginal-to-zero monetary payoff. Rejected: zero new SDK dependencies were needed to add it, and dangling ENIs are operationally annoying (they block subnet/security-group cleanup) even though they're free.

## Consequences

The report includes a $0-cost finding category. Labels and category metadata make clear to the reader that this is a hygiene signal, not a cost saving.
</content>
