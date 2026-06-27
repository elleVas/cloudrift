# ADR-0040: LocalStack bumped to 4.14.0 — CloudWatch incompatibility resolved

- **Status:** Accepted (2026-06-27)

## Context

[ADR-0039](0039-cloudwatch-localstack-incompatibility.md) documented `GetMetricStatistics` failing against LocalStack 4.0 for every CloudWatch-backed scanner, surfacing as `Unexpected token '<', "<?xml vers"... is not valid JSON`. Root cause, confirmed via [localstack/localstack#13028](https://github.com/localstack/localstack/issues/13028): AWS migrated CloudWatch from the Query (XML) protocol to AWS JSON 1.0 / Smithy RPC v2 CBOR, and `@aws-sdk/client-cloudwatch` (`^3.741.0`, already in use here) negotiates the new JSON protocol by default. LocalStack 4.0 predates LocalStack's multi-protocol CloudWatch support (added in 4.9, with a timestamp-parsing regression fixed after the 4.12 release), so it returns an XML error document the JSON-expecting client can't parse — breaking every scanner that calls `GetMetricStatistics`, not just the Phase 5.5 additions.

## Decision

Bump the pinned image in `docker-compose.localstack.yml` from `localstack/localstack:4.0` to `localstack/localstack:4.14.0` — the newest tag confirmed to (a) start as Community/Hobby with no paid license token, same as 4.0, and (b) include the CloudWatch multi-protocol fix. Verified directly (not just from the changelog): pulled the image, started it standalone, and called `GetMetricStatisticsCommand` via `@aws-sdk/client-cloudwatch` against it — got a clean `200`/JSON response instead of the XML deserialization error. Then ran the full `pnpm nx run cli:e2e-localstack` harness end-to-end: `ebs-idle`, `s3-no-lifecycle`, `lambda-underutilized`, `dynamodb-overprovisioned` (previously hard-required and now-broken per ADR-0039) and `vpn-connection-idle`, `transit-gateway-idle-attachment`, `kinesis-provisioned-idle-stream` (previously `SOFT_KINDS` because of this bug) all now produce findings correctly. Moved those 3 out of `SOFT_KINDS` in `scripts/e2e-localstack.mjs` — they're hard-required now, same as every other always-on CloudWatch-backed scanner.

`load-balancer` stays soft: its missing finding is a LocalStack Community license restriction on `elbv2` (`"... is not included within your LocalStack license"`), unrelated to this bug and not affected by the version bump. `nat-gateway` stays soft too — its original soft status from [ADR-0002](0002-localstack-e2e-scope.md) predates this bug and isn't re-evaluated here, to keep this change scoped to undoing ADR-0039's fallout specifically.

## Alternatives Considered

- **Use the `latest` tag.** Rejected: as of 2026-06, `latest` resolves to an image that refuses to start without a paid license, even for Community-tier services (already established in the original `docker-compose.localstack.yml` comment). A pinned numbered tag avoids this.
- **Wait for a future fix instead of re-testing now.** Rejected: the fix already shipped (LocalStack 4.9, hardened by 4.13+) — no need to keep carrying the gap once a compatible free tag exists.

## Consequences

The LocalStack e2e harness now exercises CloudWatch request *and* response handling for all CloudWatch-backed scanners, closing the gap ADR-0039 flagged where unit tests (mocked request-shape assertions) were the only thing validating these scanners. `docs/en/testing.md` / `docs/it/test.md` updated accordingly. `ADR-0039` is superseded by this ADR; its root-cause analysis remains the accurate historical record of why the bug happened.
