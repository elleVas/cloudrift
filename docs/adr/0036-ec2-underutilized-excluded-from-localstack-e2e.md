# ADR-0036: `ec2-underutilized` excluded from the LocalStack e2e harness

- **Status:** Accepted (2026-06-24)

## Context

ADR-0002 scoped the LocalStack e2e harness to the scanners coverable by LocalStack's free Hobby plan, originally counted as 14/18. While implementing the harness (`scripts/seed-localstack.mjs`, `scripts/e2e-localstack.mjs`), `ec2-underutilized` turned out not to be realistically testable there.

`ec2-underutilized` relies on `--live-pricing` (the EC2 Pricing API, via `pricing:GetProducts`) for an unambiguous instance-type price match — see ADR-0010 and ADR-0011. LocalStack's Pricing API support on the Hobby plan is too weak to produce a reliable match, so the scanner would either fail to price the seeded instance or require harness-specific pricing stubs that don't exist in production.

## Decision

Drop `ec2-underutilized` from `EXPECTED_KINDS` in `scripts/e2e-localstack.mjs`. The harness now targets 13/18 scanners, not 14/18. `ec2-underutilized` remains covered only by the manual `scripts/verify-against-aws.mjs` against a real AWS account, alongside `rds-instance`, `rds-underutilized`, `elasticache-idle`, and `efs-unused` (excluded for the unrelated reason of needing LocalStack's paid Base plan, per ADR-0002).

## Alternatives Considered

- **Stub/mock the Pricing API response inside the harness.** Rejected: would test the stub, not the real pricing path: ADR-0011's whole point is gating this scanner behind a price match that's verified against the actual AWS Pricing API.
- **Pay for LocalStack's paid tier for better Pricing API coverage.** Rejected for the same cost reason as ADR-0002.

## Consequences

The LocalStack e2e harness covers 13/18 scanners. `ec2-underutilized` is one of five scanners (along with the four already excluded by ADR-0002) verified only manually via `scripts/verify-against-aws.mjs`. This gap is documented in `docs/en/testing.md` / `docs/it/test.md`.
