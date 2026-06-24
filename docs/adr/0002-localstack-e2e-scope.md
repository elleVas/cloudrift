# ADR-0002: LocalStack e2e scope limited to 13/18 scanners

- **Status:** Accepted (2026-06-21), implemented (2026-06-24, see ADR-0036 for the `ec2-underutilized` exclusion discovered during implementation)

## Context

An e2e harness needs a live-ish AWS environment without burning real cloud cost or requiring AWS credentials in CI.

## Decision

Use LocalStack Community/Hobby (free, requires a free registered account and `LOCALSTACK_AUTH_TOKEN` — discovered during implementation, not anonymous as originally assumed) for the scanners it covers (EC2/EBS/EIP/S3/Lambda/DynamoDB/CloudWatch-based). `rds-instance`, `rds-underutilized`, `elasticache-idle` and `efs-unused` are left out of the e2e harness because LocalStack's free tier doesn't emulate RDS/ElastiCache/EFS; they remain covered only by the manual `scripts/verify-against-aws.mjs` against a real account. `ec2-underutilized` is also excluded — see ADR-0036.

Scanner code changes were needed after all: the S3 SDK client defaults to virtual-hosted-style addressing, which doesn't resolve against a non-AWS endpoint like LocalStack. `AwsS3NoLifecycleScanner` now sets `forcePathStyle: true` when `AWS_ENDPOINT_URL` is set, with no effect on real AWS usage.

## Alternatives Considered

- **Pay for LocalStack Pro/Base (~$29/month)** to get full RDS/ElastiCache/EFS coverage. Rejected by the user — cost not justified at this stage.
- **Spin up a real (low-cost) AWS sandbox account for e2e CI.** Rejected: reintroduces real AWS credentials and cost into CI, defeating the purpose of a free, repeatable harness.

## Consequences

e2e coverage is intentionally partial (13/18); the gap is documented (`docs/en/testing.md`), not hidden. Harness pieces: `docker-compose.localstack.yml`, `scripts/seed-localstack.mjs`, `scripts/e2e-localstack.mjs`, a dedicated opt-in Nx target (not wired into `lint`/`test`/`build`/`typecheck`), and a dedicated CI job requiring the `LOCALSTACK_AUTH_TOKEN` repo secret. `nat-gateway` seeds and scans successfully. `load-balancer` does not — LocalStack's Hobby plan flatly rejects `elbv2` calls with a license error (not the "partial support" originally assumed); it's treated as a soft-missing kind so the harness doesn't fail on it.
