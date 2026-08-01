# ADR-0015: `FindingCategory` split: waste vs. optimization

- **Status:** Accepted

## Context

Not every finding means "delete this resource and stop paying" — some (gp2→gp3, EC2/RDS rightsizing) are savings opportunities that keep the resource.

## Decision

Tag every `ResourceKind` in `RESOURCE_KIND_META` with `category: 'waste' | 'optimization'` and an `estimated` flag. Only `'waste'` feeds `totalWasteMonthlyUsd` and the CI cost gate (`costAlertThresholdUsd`); `'optimization'` is shown separately as `totalOptimizationMonthlyUsd`.

## Alternatives Considered

- **Report a single blended total.** Rejected: would conflate "money being actively wasted right now, fixable by deleting something" with "a savings opportunity requiring a deliberate rightsizing decision" — misleading both the headline number and the CI gate.

## Consequences

Reports show two distinct totals. `estimated: true` further flags numbers that need human judgment before acting (e.g. low CPU alone doesn't prove RAM/network or storage I/O are equally idle for `ec2-underutilized`/`rds-underutilized`).

**Update (2026-08-01):** `estimated` says a finding needs verifying but doesn't say *how defensible the number itself is* — a real price difference and a blind percentage were both just `estimated: true`. [ADR-0101](0101-finding-confidence-real-price-differences.md) adds an orthogonal `FindingConfidence` axis (`measured`/`derived`/`heuristic`) for that; `category`/`estimated` are unchanged here and still drive the CI gate.
