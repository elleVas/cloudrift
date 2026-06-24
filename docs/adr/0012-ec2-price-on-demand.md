# ADR-0012: EC2 per-instance-type price fetched on demand

- **Status:** Accepted

## Context

Same cardinality problem as [ADR-0011](0011-live-pricing-gated-scanners.md), specifically for EC2 instance types.

## Decision

`AwsEc2UnderutilizedScanner` calls `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)` once per **distinct instance type actually observed** during the scan, instead of pre-warming a full price table in `warmUp()`.

## Alternatives Considered

- **Pre-fetch all EC2 instance type prices for the account's regions at `warmUp()` time.** Rejected: most accounts use a handful of instance types; fetching AWS's entire catalog up front wastes API calls for types that will never appear in the scan.

## Consequences

Pricing API call volume scales with the number of distinct instance types actually in use, not with AWS's full catalog. This is the one scanner that doesn't fit the three-layer model in [ADR-0009](0009-three-pricing-layers.md) — by design.
