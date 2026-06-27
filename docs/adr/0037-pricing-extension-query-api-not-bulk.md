# ADR-0037: New scanners' pricing extends the Query API, not the Bulk API

- **Status:** Accepted (2026-06-27)

## Context

Phase 5.5 adds 11 new fixed-cost scanners (Redshift, OpenSearch, MSK, FSx, DocumentDB, Neptune, Amazon MQ, WorkSpaces, VPN Site-to-Site, Transit Gateway attachments, Kinesis Provisioned). Each needs a price source under the existing three-layer system ([ADR-0009](0009-three-pricing-layers.md)). AWS exposes pricing two ways: the Query API (`GetProducts`, already used by `AwsPricingApiAdapter`) and the Bulk API (public, unauthenticated JSON/CSV offer files).

## Decision

Extend `AwsPricingApiAdapter` with the Query API, following the cardinality split already in place: low-cardinality fixed-SKU services go into `PRICE_SPECS` and get prefetched in `warmUp` (same pattern as NAT Gateway / Elastic IP / EBS volume types); services priced per instance/node type (Redshift nodes, OpenSearch/DocumentDB instance classes, MSK broker types) get a lazy `getXxxPricePerMonth` method, same pattern as `getEc2InstancePricePerMonth`/`getRdsInstancePricePerMonth`/`getElastiCacheNodePricePerMonth`.

The Bulk API's main advantage — no AWS credentials needed — does not apply here: the CLI already requires AWS credentials to scan the account's resources, so adding `pricing:GetProducts` to the IAM policy is a non-issue. The Query API's main weakness — low rate limits — is already mitigated by `PRICING_CONCURRENCY` and is bounded for these 11 services (similar order of magnitude to the existing specs).

## Alternatives Considered

- **Bulk API for the new services.** Rejected for the live `--live-pricing` path: it requires downloading and parsing large, versioned offer-index files per service, with no server-side filtering, for no real benefit given credentials are already available.
- **Bulk API kept as a backlog idea**, not discarded: it is a good fit for a *different* future use case — an offline script that periodically regenerates the static `prices.json` fallback (the level-1 layer), decoupled from the live per-scan path. There, the cost of parsing a large file is paid once (on a schedule), not on every scan. Deferred, not part of 5.5.

## Consequences

No new pricing abstraction needed; `PricingPort`/`TablePricingAdapter`/`prices.json`/`AwsPricingApiAdapter` are extended with the same shapes already used for the first 18 scanners. A future offline `prices.json`-refresh script via the Bulk API remains an open backlog item, not a blocker for 5.5.
