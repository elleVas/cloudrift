# ADR-0068: SageMaker scanners excluded from the LocalStack e2e harness

- **Status:** Accepted (2026-07-14)

## Context

Phase 6.3 (ADR-0065) added `sagemaker-notebook-idle`, `sagemaker-endpoint-idle`, and `sagemaker-training-orphaned`. Before wiring seeding for them into `scripts/seed-localstack.mjs`, the underlying assumption — that LocalStack Community/Hobby can host SageMaker the same way it hosts EC2/EBS/S3/DynamoDB — was checked empirically against the running container (`localstack/localstack:4.14.0`, the pinned Community image, see ADR-0040):

- `GET /_localstack/health` does not list `sagemaker` among the available services at all (unlike `ec2`, `s3`, `dynamodb`, etc.).
- A direct `sagemaker list-endpoints` call against the container returns: `"Sorry, the sagemaker service is not included within your LocalStack license, but is available in an upgraded license."`

This is the same class of gap as `fsx-idle-filesystem` (ADR-0002/ADR-0038: LocalStack rejects the service outright, pro-only) rather than the `ec2-underutilized`/`--live-pricing` class (ADR-0036: service is mockable, but pricing isn't) — there is no partial support or soft-missing middle ground to fall back to.

## Decision

None of the three SageMaker scanners are seeded or added to `EXPECTED_KINDS` in `scripts/e2e-localstack.mjs`. All three stay on manual verification against a real AWS account only (`scripts/verify-against-aws.mjs`, to be run by the project owner after the full Phase 6 scanner set is built, per the phase's own sequencing).

## Alternatives Considered

- **Pay for LocalStack's paid tier to get SageMaker coverage.** Rejected for the same recurring cost-not-justified reason as ADR-0002 and ADR-0036.
- **Stub the SageMaker responses inside the harness.** Rejected: same reasoning as ADR-0036 — it would test the stub, not a real integration, defeating the purpose of this specific harness layer (the contract-fixture layer, not this one, is where transcribed/hand-built responses belong — see `docs/en/testing.md`).

## Consequences

The LocalStack e2e harness's exclusion list grows by 3 (`sagemaker-notebook-idle`, `sagemaker-endpoint-idle`, `sagemaker-training-orphaned`), alongside the pre-existing `rds-instance`/`rds-underutilized`/`elasticache-idle`/`efs-unused`/`ec2-underutilized` (ADR-0002/ADR-0036), the 7 `--live-pricing` Phase 5.5 scanners, `fsx-idle-filesystem`, and `aurora-serverless-overprovisioned` (ADR-0065). Documented in `docs/en/testing.md` / `docs/it/test.md`.
