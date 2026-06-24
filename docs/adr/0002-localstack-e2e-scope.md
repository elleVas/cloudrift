# ADR-0002: LocalStack e2e scope limited to 14/18 scanners

- **Status:** Accepted (2026-06-21), implementation in progress

## Context

An e2e harness needs a live-ish AWS environment without burning real cloud cost or requiring AWS credentials in CI.

## Decision

Use LocalStack Community/Hobby (free) for the 14 scanners it covers (EC2/EBS/EIP/S3/Lambda/DynamoDB/CloudWatch-based). `rds-instance`, `rds-underutilized`, `elasticache-idle` and `efs-unused` are left out of the e2e harness because LocalStack's free tier doesn't emulate RDS/ElastiCache/EFS; they remain covered only by the manual `scripts/verify-against-aws.mjs` against a real account.

No scanner code changes: AWS SDK v3 already supports `AWS_ENDPOINT_URL` natively, so pointing at LocalStack is purely an env-var override at the test-script level.

## Alternatives Considered

- **Pay for LocalStack Pro/Base (~$29/month)** to get full RDS/ElastiCache/EFS coverage. Rejected by the user — cost not justified at this stage.
- **Spin up a real (low-cost) AWS sandbox account for e2e CI.** Rejected: reintroduces real AWS credentials and cost into CI, defeating the purpose of a free, repeatable harness.

## Consequences

e2e coverage is intentionally partial (14/18); the gap is documented (`docs/en/testing.md`), not hidden. New harness pieces: `docker-compose.localstack.yml`, `scripts/seed-localstack.mjs`, `scripts/e2e-localstack.mjs`, a dedicated opt-in Nx target (not wired into `lint`/`test`/`build`/`typecheck`). Known risk to verify during implementation: LocalStack community support for `nat-gateway` and `load-balancer` has historically been partial — if either doesn't work, exclude it without blocking the rest.
</content>
