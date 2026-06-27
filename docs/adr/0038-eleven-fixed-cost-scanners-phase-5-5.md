# ADR-0038: 11 new fixed-cost scanners in v0.5.0 Phase 5.5

- **Status:** Accepted (2026-06-27)

## Context

A competitive analysis (aws-finops-dashboard, Infracost, Cloud Custodian) surfaced AWS services with a fixed at-rest cost that cloudrift did not yet cover. Redshift specifically had been deferred since [ADR-0003](0003-redshift-deferred.md).

## Decision

Add 11 new scanners in Phase 5.5, all in the same phase rather than split across releases: Redshift (idle cluster), OpenSearch/Elasticsearch, MSK, FSx, DocumentDB, Neptune, Amazon MQ, WorkSpaces, VPN Site-to-Site, Transit Gateway attachments, and Kinesis in Provisioned mode only (not On-Demand, which is pay-per-use). All 11 satisfy the existing [scanner coverage criteria](0001-scanner-coverage-criteria.md): provisioned resources with a fixed cost at rest, not pay-per-use/serverless billing.

Pricing for these scanners extends the Query API per [ADR-0037](0037-pricing-extension-query-api-not-bulk.md). Default thresholds use the existing `waste-policy.ts`/`cloudrift.config.ts` mechanism — no new policy engine.

## Alternatives Considered

- **Split across two phases (e.g. 5.5/5.6).** Rejected: no technical dependency between the 11 scanners that would justify splitting; confirmed explicitly to keep them in one phase.
- **Kinesis On-Demand mode.** Rejected: pay-per-use billing, out of scope per ADR-0001 — only Provisioned-mode shard capacity qualifies.

## Consequences

Scanner count goes from 18 to 29. Each new scanner follows the same per-scanner checklist already established: scanner implementation, pricing entry (prefetched or lazy, per ADR-0037), `.scanner.spec.ts`, default threshold, resource presenter entry (console/PDF/markdown), and LocalStack seed entry where the service is supported on the free Hobby plan (services requiring LocalStack's paid Base plan fall back to manual verification via `scripts/verify-against-aws.mjs`, same treatment as RDS/ElastiCache/EFS in Phase 5).
