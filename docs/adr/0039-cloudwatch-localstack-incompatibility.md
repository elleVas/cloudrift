# ADR-0039: GetMetricStatistics fails on LocalStack 4.0 — CloudWatch scanners marked soft

- **Status:** Accepted (2026-06-27)

## Context

While validating Phase 5.5's 3 always-on CloudWatch-backed scanners (`vpn-connection-idle`, `transit-gateway-idle-attachment`, `kinesis-provisioned-idle-stream`) against a real LocalStack container, the underlying `latest` image turned out to require a paid license to start at all (fixed separately by pinning `docker-compose.localstack.yml` to `localstack/localstack:4.0`, the last confirmed Community-only image).

With LocalStack actually running, `scripts/seed-localstack.mjs` created the VPN connection, Transit Gateway attachment, and Kinesis stream successfully — confirmed independently via direct `aws ec2 describe-vpn-connections` / `describe-transit-gateway-attachments` / `kinesis list-streams` calls against the container, all returning the expected resources in the expected state (`available`). But `cloudrift analyze` produced zero findings for all three, with a scan error: `Unexpected token '<', "<?xml vers"... is not valid JSON — Deserialization error`.

Checking `scanErrors` for the full run showed the **same error on every single CloudWatch-backed scanner**, not just the 3 new ones: `nat-gateway`, `ebs-idle`, `lambda-underutilized`, `dynamodb-overprovisioned`, and `s3-no-lifecycle` (which fetches `BucketSizeBytes` via CloudWatch) all failed identically. Scanners that don't call CloudWatch (`ebs-volume`, `ebs-snapshot`, `elastic-ip`, `eni-orphaned`, `ec2-instance`, `log-group`, `ebs-gp2-upgrade`) all succeeded normally.

## Decision

Treat this as a LocalStack/AWS-SDK protocol incompatibility (the SDK's CloudWatch client expects a JSON response and LocalStack 4.0 returns an XML error document), not a scanner bug — confirmed by the fact that it breaks already-shipped, already-tested scanners equally, with no code change on this side. `vpn-connection-idle`, `transit-gateway-idle-attachment`, and `kinesis-provisioned-idle-stream` are added to `EXPECTED_KINDS` as `SOFT_KINDS` (warning, not hard failure) in `scripts/e2e-localstack.mjs`, same treatment as the pre-existing `nat-gateway`/`load-balancer` soft kinds.

Their correctness is instead verified by: (1) unit tests asserting the exact `GetMetricStatistics` request shape (`Namespace`, `MetricName`, `Dimensions`, `Period`, `Statistics`) — the same technique already trusted for every other CloudWatch-backed scanner; (2) the direct AWS CLI verification above, confirming the non-CloudWatch API calls (`Describe*`/`List*`/`Create*`) work correctly against LocalStack.

## Alternatives Considered

- **Chase a working LocalStack tag/SDK combination.** Rejected for now: time-boxed investigation, no quick fix found, and the bug already affects pre-Phase-5.5 scanners — fixing it is a separate, broader effort, not blocking this phase.
- **Mark the 4 pre-existing affected hard kinds (`ebs-idle`, `lambda-underutilized`, `dynamodb-overprovisioned`, `s3-no-lifecycle`) as soft too.** Not done here: out of scope for Phase 5.5 (they were already shipped and hard-required before this work started) — flagged as a known caveat for a future fix, not silently changed.

## Consequences

As of 2026-06-27, running `pnpm nx run cli:e2e-localstack` against `localstack/localstack:4.0` will hard-fail on `ebs-idle`, `lambda-underutilized`, `dynamodb-overprovisioned`, and `s3-no-lifecycle` (pre-existing hard kinds, now broken by the same root cause) until either LocalStack/the SDK fixes the incompatibility or those 4 are also moved to `SOFT_KINDS`. This is a known, documented gap, not addressed by this ADR.
