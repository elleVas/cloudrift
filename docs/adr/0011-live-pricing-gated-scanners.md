# ADR-0011: EC2/RDS/ElastiCache underutilized scanners gated behind `--live-pricing`

- **Status:** Accepted

## Context

`AwsEc2UnderutilizedScanner`, `AwsRdsUnderutilizedScanner`, and `AwsElastiCacheIdleScanner` need per-instance-type/class/node-type pricing — too high a cardinality to put in `prices.json` or pre-fetch in `warmUp()`.

## Decision

The composition root (`analyze-waste.composition.ts`) registers these three scanners **only** when `--live-pricing` is set. Without it, the scanners simply aren't added to the run — no scanner means no zero/placeholder finding.

## Alternatives Considered

- **Register them always and report a $0/unknown estimate without live pricing.** Rejected: a savings opportunity with no number attached isn't actionable and pollutes the report with noise.
- **Pre-fetch a curated subset of "common" instance types into `prices.json`.** Rejected: incomplete by construction — would silently miss less-common types and create the illusion of full coverage.

## Consequences

These three checks don't run at all without `--live-pricing`. This is documented behavior (see `docs/en/technical-choices.md`), not a hidden gap.
</content>
