# Testing

> 🇮🇹 [Versione italiana](../it/test.md)

This document describes the test pyramid for cloudrift: what each level covers, where to find concrete examples, how to run the LocalStack e2e harness, and how to manually verify scanners against a real AWS sandbox account.

## The pyramid

```
        ┌─────────────────────────┐
        │   CLI e2e (apps/cli)    │   command-level: format, exit code, artifacts
        ├─────────────────────────┤
        │ Infra (contract tests)  │   real response fixtures replayed: shape → findings, 44/44
        ├─────────────────────────┤
        │  Infra (scanner specs)  │   AWS SDK mocked: query shape, pagination, errors
        ├─────────────────────────┤
        │  Domain (entity/policy) │   pure logic: waste rules, boundaries, no I/O
        └─────────────────────────┘
        ┌─────────────────────────┐
        │  LocalStack e2e (free)  │   scripts/e2e-localstack.mjs (this doc), 17/44 scanners
        ├─────────────────────────┤
        │  Manual AWS sandbox     │   scripts/verify-against-aws.mjs (this doc)
        ├─────────────────────────┤
        │  Real-AWS verification  │   external CDK test harness (see below), 36/44 scanners
        └─────────────────────────┘
```

### Domain — entities and policies

Pure unit tests, no mocks. One spec per entity, asserting the exposed fields, the entity-specific computed value, `kind`, `wasteReason` and `costEstimate`:

- [`libs/cloud-cost/domain/src/entities/ebs-snapshot.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/ebs-snapshot.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/elastic-ip.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/elastic-ip.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/gp2-volume.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/gp2-volume.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/idle-ebs-volume.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/idle-ebs-volume.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/underutilized-ec2-instance.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/underutilized-ec2-instance.entity.spec.ts)
- [`libs/cloud-cost/domain/src/entities/rds-underutilized-instance.entity.spec.ts`](../../libs/cloud-cost/domain/src/entities/rds-underutilized-instance.entity.spec.ts)

Each policy lives in its own file under [`libs/cloud-cost/domain/src/policies/`](../../libs/cloud-cost/domain/src/policies/) (named after the entity it judges, e.g. `ebs-volume.policy.ts`), mirroring the one-file-per-entity layout above. Their tests are consolidated in one spec, [`libs/cloud-cost/domain/src/policies/waste-policies.spec.ts`](../../libs/cloud-cost/domain/src/policies/waste-policies.spec.ts), covering for every policy: waste vs not-waste, the grace period, the `ignoreTag`, `excludeTagValues`, and the exact boundary of each threshold (age `===` `minAgeDays`, CPU `===` threshold, ops `===` `maxOps`) — boundaries matter because grace-period and CPU/ops comparisons use opposite-strictness operators (`<` vs `>=`/`>`), so an off-by-one there silently changes which resources get flagged.

### Infra — scanners

One spec per scanner under [`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/), with the AWS SDK client mocked. Each covers: the candidate filter (e.g. `DescribeVolumes` with `Filters=[status=available]`), pagination, concurrency, SDK errors, and `destroy()` on the client. Twenty-four scanners are CloudWatch-based — the original nine (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`, `aws-efs-unused`, `aws-lambda-underutilized`, `aws-s3-no-lifecycle`, `aws-dynamodb-overprovisioned`, `aws-elasticache-idle`), ten added in Phase 5.5 (`aws-fsx-idle`, `aws-redshift-idle`, `aws-opensearch-idle`, `aws-msk-idle`, `aws-documentdb-idle`, `aws-neptune-idle`, `aws-mq-idle`, `aws-vpn-connection-idle`, `aws-transit-gateway-idle`, `aws-kinesis-idle`; `aws-workspaces-idle` is the one Phase 5.5 scanner that is *not* CloudWatch-based, it polls `DescribeWorkspacesConnectionStatus` instead), plus five added in Phase 6 (`aws-sqs-dlq-abandoned`, `aws-aurora-serverless-idle`, `aws-sagemaker-notebook-idle`, `aws-sagemaker-endpoint-idle`, `aws-eks-node-overprovisioned`) — and additionally assert the exact `Namespace`, `Period`, `Statistics` and `Dimensions` sent to `GetMetricStatistics`. 23 of these 24 extend the shared `CloudWatchIdleScanner` template method ([ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md), tested independently in [`cloudwatch-idle.scanner.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/cloudwatch-idle.scanner.spec.ts) against a fake concrete subclass); `aws-s3-no-lifecycle` is the one exception (a fixed 1-day CloudWatch period regardless of the lookback window doesn't fit the template) and calls the lower-level pure functions in [`cloudwatch-metrics.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/utils/cloudwatch-metrics.ts) (also independently tested) directly. Because every migrated scanner kept its exact `GetMetricStatisticsCommand` arguments, none of the original 19 scanner specs needed to change when the base class was introduced. This is the contract both the manual verification script below (currently covering four: `aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`) and the LocalStack e2e harness lean on; [ADR-0039](../adr/0039-cloudwatch-localstack-incompatibility.md)/[ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) found and then fixed `GetMetricStatistics` failing against LocalStack 4.0 for every one of the (then nineteen) CloudWatch-based scanners, so the e2e harness now actually exercises the CloudWatch request/response path, not just the unit-tested request shape.

**Required-field guards.** Every scanner (CloudWatch-based or not) filters out AWS response entries missing a required identifier field (e.g. `VolumeId`) via a type-narrowing `.filter()` rather than a non-null assertion, logging the drop via `DEBUG=cloudrift:*` — see [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md). The existing scanner specs, which mock well-formed SDK responses, exercise this as a pass-through; there is no dedicated "malformed response" test per scanner today.

### Infra — contract tests (fixture replay)

The scanner specs above build minimal payloads by hand, so they can't tell whether the shape a scanner *expects* still matches what AWS actually *returns*. [`scanner-contract.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/scanner-contract.spec.ts) closes that gap for all 44 scanners ([ADR-0053](../adr/0053-contract-tests-fixture-replay.md)): each kind has a JSON fixture in [`src/testing/contract-fixtures/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/testing/contract-fixtures/) holding full raw responses — `$metadata`, pagination cursors and all — keyed by Command name, plus the exact findings the live run produced; the spec replays the pages through the scanner's whole pipeline (list → type-narrowing → metric → `toEntity` → policy) and asserts the same findings come out. The Command classes stay real (no `jest.mock` of the SDK modules): the only seam is the `send` method on the SDK's shared `Client` base class. A coverage test fails if a `ResourceKind` ever ships without a fixture, and the `ebs-snapshot` fixture doubles as the pagination contract (its expected finding lives on page 2, reachable only by following `NextToken`).

Fixture provenance is recorded in each file's `source` field: 14 were captured from seeded LocalStack by [`scripts/capture-contract-fixtures.mjs`](../../scripts/capture-contract-fixtures.mjs) (rerun it to regenerate them after an SDK bump or a scanner query change — it never overwrites the transcribed ones), and 29 were transcribed from the AWS API reference for the kinds LocalStack Community can't host (elbv2/RDS/EFS/FSx rejected by license, the 10 `--live-pricing` scanners because the Pricing API is a real signed endpoint; `ebs-snapshot` is transcribed instead of captured because moto pre-seeds >1000 canned public snapshots) — plus the 5 scanners added 2026-07-22 (`ami-unused`, `ecr-image-untagged`, `s3-multipart-upload-abandoned`, `rds-manual-snapshot-old`, `secretsmanager-unused`), none of which the capture script covers yet either.

### CLI e2e

[`apps/cli/src/commands/analyze-waste.command.spec.ts`](../../apps/cli/src/commands/analyze-waste.command.spec.ts) drives the command with a fake `AnalyzeDeps` (no AWS), asserting format selection (table/json/markdown), exit codes (0/1/2), the `--json <file>` and `--pdf <file>` artifacts, and that a partial scan (`summary.scanErrors` non-empty) doesn't crash the command — the exit code stays driven only by the cost threshold, never by scan errors, and the incomplete-scan note (produced by the formatters, see [`waste-report.markdown-formatter.spec.ts`](../../apps/cli/src/formatters/waste-report.markdown-formatter.spec.ts)) reaches stdout. `analyze-waste.composition.ts` — the `defaultAnalyzeDeps` implementation the fake stands in for — has no spec of its own by design: it only wires real AWS adapters together (same pattern as `aws-account-id.resolver.ts`), and that wiring is exactly what the fake is meant to bypass in unit tests.

### Cost analytics — `cost`/`trend`

Same shape as `analyze`, one layer at a time, none of it touching AWS or real money:

- **Domain/application**: [`compare-cost.use-case.spec.ts`](../../libs/cloud-cost/application/src/use-cases/compare-cost.use-case.spec.ts) covers the day-of-month window logic (current vs. previous period), clipping the previous period instead of spilling into the current month when it's shorter, propagating a `CostExplorerPort` failure unchanged, and the regression found during real-AWS verification: `changePercent` reports `null` rather than an astronomical percentage when the previous period rounds to $0.00. [`cost-trend.use-case.spec.ts`](../../libs/cloud-cost/application/src/use-cases/cost-trend.use-case.spec.ts) covers bucket-to-month mapping, service filtering, and requesting exactly `months` calendar months including the current partial one.
- **Infra — cache**: [`cost-explorer-cache.adapter.spec.ts`](../../libs/cloud-cost/infrastructure/aws-adapter/src/cost-explorer/cost-explorer-cache.adapter.spec.ts) covers `CachedCostExplorerAdapter`'s disk cache ([ADR-0070](../adr/0070-cost-explorer-disk-cache-decorator.md)): serving repeat identical closed-range requests from disk instead of re-calling (re-billing) Cost Explorer, never caching a range touching the still-open current period, `--refresh-cache` bypassing but still refreshing the cache, per-account cache keys, and propagating a failure without caching it. `AwsCostExplorerAdapter` itself (the real `GetCostAndUsageCommand` call) has no spec of its own — same "thin real-AWS wiring, bypassed by the fake in every other test" pattern as `analyze-waste.composition.ts` above.
- **CLI e2e**: [`cost.command.spec.ts`](../../apps/cli/src/commands/cost.command.spec.ts) and [`trend.command.spec.ts`](../../apps/cli/src/commands/trend.command.spec.ts) drive the commands with a fake `CostAnalyticsDeps` (no AWS, no Cost Explorer charge), asserting format selection (table/json), input validation (`--format`, `--fail-on-increase`, `--months`), the `--fail-on-increase`/`costIncreaseAlertPercent` gate (explicit flag overrides config; exit 2 on a spend spike; no gate when neither is set), `trend`'s cost-shorthand resolution (`ec2` → the documented Cost Explorer service name; an unresolved shorthand passes through unchanged), and `--silent` suppressing stdout entirely. Both commands call `confirmCostExplorerCharge()` directly (it's not part of the injectable `CostAnalyticsDeps` seam), but under Jest `isInteractiveTty()` is false, so it always short-circuits to "proceed" before ever reaching the `@clack/prompts` confirm call — the confirmation prompt itself has no dedicated spec and is unverified outside manual use.

### Dead resources — `dead-resources`

A separate domain from `WastedResource` ([ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md)), tested the same way, layer by layer:

- **Domain**: one entity spec + one policy spec per kind — the original 4 (`ec2-keypair-unused`, `ec2-ri-expiring-soon`, `iam-user-inactive`, `iam-policy-unattached`), 9 added 2026-07-23 morning (`iam-role-unused`, `iam-access-key-stale`, `ec2-security-group-unused`, `logs-loggroup-empty`, `acm-certificate-unused`, `route53-hostedzone-empty`, `cloudformation-stack-stuck`, `s3-bucket-empty`, `cloudwatch-alarm-orphaned`), plus 5 more added the same day (`sns-topic-unsubscribed`, `iam-instance-profile-unattached`, `eventbridge-rule-no-targets`, `ecr-repository-empty`, `stepfunctions-statemachine-unused`) — 18 kinds total, in `libs/dead-resources/domain/src/{entities,policies}/`, same shape as the `cloud-cost-domain` specs above: grace-period boundaries, the ignore tag, and each policy's own kind-specific threshold where it has one. Five kinds (`ec2-security-group-unused`, `route53-hostedzone-empty`, `sns-topic-unsubscribed`, `eventbridge-rule-no-targets`) skip the grace-period machinery entirely — their AWS list APIs expose no creation timestamp, so their policies just apply the shared tag exclusions and flag unconditionally; their specs assert that directly instead of a grace-period boundary case.
- **Infra — scanners**: one spec per scanner in `libs/dead-resources/infrastructure/aws-adapter/src/scanners/`, SDK mocked the same way as `cloud-cost-infrastructure-aws-adapter`'s scanner specs. `aws-iam-user-inactive.scanner.spec.ts` additionally covers the `ListAccessKeys`→`GetAccessKeyLastUsed` fan-out (password login alone is enough to clear a user with zero access keys); `aws-s3-bucket-empty.scanner.spec.ts`/`aws-ecr-repository-empty.scanner.spec.ts` cover a per-resource inspection failure being skipped rather than failing the whole scan. `aws-iam-instance-profile-unattached.scanner.spec.ts` is the one genuinely different shape in this domain: it mocks both `IAMClient` and `EC2Client`, captures each `EC2Client`'s bound region from its constructor config (the mock's `send` branches on `command instanceof X` plus that captured region), and asserts an instance profile attached to an instance in a *non-default* enabled region is correctly **not** flagged — the actual behavior the account-wide, all-region cross-reference exists to get right, not just the single-region happy path every other scanner's test covers. `aws-stepfunctions-statemachine-unused.scanner.spec.ts` asserts an `EXPRESS`-type machine short-circuits before any `ListExecutions` call.
- **Infra — contract tests**: [`dead-resources-contract.spec.ts`](../../libs/dead-resources/infrastructure/aws-adapter/src/scanners/dead-resources-contract.spec.ts) mirrors `scanner-contract.spec.ts` (ADR-0053) for this domain — one hand-transcribed fixture per kind in `src/testing/contract-fixtures/`, replayed through each scanner's full pipeline. All 18 are transcribed, none LocalStack-captured (see below); each kind-specific threshold is nulled out in the test's own scanner factories (`minAgeDays: 0`, a very large `expiringWithinDays`/`inactivityDays`) so the fixtures' fixed dates never go stale. Ten of the SDK clients beyond `EC2Client`/`IAMClient` (`CloudWatchLogsClient`, `ACMClient`, `Route53Client`, `CloudFormationClient`, `S3Client`, `CloudWatchClient`, `SNSClient`, `EventBridgeClient`, `ECRClient`, `SFNClient`) each got their own `@smithy/core` base-object entry in the test's client-patching list, not assumed to share one with `EC2Client`/`IAMClient` — see that file's comment for the empirically-verified reasoning already established for ECR/Secrets Manager on the cost-waste side. `iam-instance-profile-unattached`'s fixture pins `DescribeRegionsCommand` to return exactly one enabled region so its `DescribeInstancesCommand` page (also patched via the shared `EC2Client` base) is only consumed once — the scanner's real multi-region fan-out behavior is covered by its own unit spec above, not by the contract fixture.
- **Application**: [`find-dead-resources.use-case.spec.ts`](../../libs/dead-resources/application/src/use-cases/find-dead-resources.use-case.spec.ts) covers the same coordinator behaviors as `AnalyzeCloudWasteUseCase`'s spec (aggregation, per-job error isolation, concurrency bound), plus what's actually new in this coordinator: a `scope: 'global'` scanner gets exactly one job regardless of how many regions were requested, a global and a regional scanner coexist correctly in the same run, and a global scanner's `scanErrors` entry is labeled `'global'`, not a real (and misleading) region code.
- **CLI e2e**: [`dead-resources.command.spec.ts`](../../apps/cli/src/commands/dead-resources.command.spec.ts) drives the command with a fake `DeadResourcesDeps`, covering format/`--min-age-days`/region validation, `--scanners` validation and its precedence over the wizard's `scannerKinds` field, `--silent`, and a PDF file actually written to disk (asserting the `%PDF-` magic bytes, same pattern `analyze-waste.command.spec.ts` uses). [`dead-resource-presenters.spec.ts`](../../apps/cli/src/formatters/dead-resource-presenters.spec.ts) covers the exhaustive-switch dispatch (ADR-0059) for all 18 kinds, including which presenters omit the Region column (the global-scope kinds). [`dead-resources-report.pdf-formatter.spec.ts`](../../apps/cli/src/formatters/dead-resources-report.pdf-formatter.spec.ts) is a smoke test (completes without throwing, valid PDF bytes) for a multi-kind summary, an empty one, and one with scan warnings — same level of PDF testing as `cost-comparison.pdf-formatter.spec.ts`, not pixel-level assertions.

**Real-AWS verification, 2026-07-23**: four separate runs against a real account (583359355881).

The **original 4 kinds** were run first, single-region (`eu-central-1`). `ec2-keypair-unused` found a real finding (`eu-central-kp`, created 2023-09-13) and rendered correctly end-to-end into the PDF (masthead, metric boxes, breakdown table, top findings, detail page). The other three (`ec2-ri-expiring-soon`, `iam-user-inactive`, `iam-policy-unattached`) ran with zero SDK/IAM/parsing errors (no scan-warnings section in the report) but produced no findings on this account — call and response shape confirmed live, but the finding+policy match path unverified for those three, same distinction already drawn for `rds-manual-snapshot-old`/`secretsmanager-unused` on the cost-waste side (see [Real-AWS verification status](#real-aws-verification-status-broader-than-verify-against-awsmjs) below). `ec2-ri-expiring-soon` is regional and was only confirmed clean for `eu-central-1` from this run, not every region.

**All 13 kinds that existed at the time** were then run together via the interactive wizard, two regions (`us-east-1`, `eu-central-1`), `--pdf` output. Zero scan-warnings — every one of the 13 checks completed without an SDK/IAM/parsing error. Three produced real findings: `ec2-keypair-unused` (`eu-central-kp`, as above), and two of the 9 kinds added that morning — **`iam-role-unused`** (role `S3ReadOnly`, never assumed since creation 2023-10-23) and **`ec2-security-group-unused`** (group `WebAccess`, `sg-0f7fdd4a079904424`, not referenced by any ENI). Both rendered correctly into the PDF's breakdown table, top-findings list, and their own detail page. The remaining 7 of that batch (`iam-access-key-stale`, `logs-loggroup-empty`, `acm-certificate-unused`, `route53-hostedzone-empty`, `cloudformation-stack-stuck`, `s3-bucket-empty`, `cloudwatch-alarm-orphaned`) ran clean with no matches on this account — call and response shape confirmed live (no errors), but the finding+policy match path is unverified for those 7, same "shape confirmed, live match unconfirmed" caveat as `ec2-ri-expiring-soon`/`iam-user-inactive`/`iam-policy-unattached` above.

**The 5 kinds added later the same day** (`sns-topic-unsubscribed`, `iam-instance-profile-unattached`, `eventbridge-rule-no-targets`, `ecr-repository-empty`, `stepfunctions-statemachine-unused`) were then run against the same account via the wizard, all 18 kinds together, two regions. This run surfaced a real robustness bug rather than a correctness one: `iam-instance-profile-unattached`'s all-region cross-reference (see its own doc comment) bursts fresh DNS+TCP+TLS handshakes to ~15-20 distinct regional endpoints at once, tighter than `createAwsClientConfig`'s `connectionTimeout` (then 5s) tolerated on the tester's home network — six unrelated jobs (`logs-loggroup-empty`×2 regions, `ec2-security-group-unused`×2 regions, `iam-access-key-stale`, `iam-policy-unattached`) failed with connection-timeout/socket-hang-up errors that happened to be running concurrently during that burst, surfaced honestly as `scanErrors` rather than silently dropped. Fixed same day: `connectionTimeout` raised from 5s to 10s (in both `createAwsClientConfig` copies, cost-waste and dead-resources — this benefits every scanner on a slow home connection, not just this one) and `iam-instance-profile-unattached`'s own `REGION_SCAN_CONCURRENCY` lowered from 5 to 3 (fewer simultaneous fresh handshakes to different hosts, unlike this domain's other fan-outs which repeat calls against one already-connected client). A follow-up run confirmed the fix: **zero scan-warnings**, all 18 checks completed cleanly. Two of the 5 new kinds produced real findings — **`iam-instance-profile-unattached`** (profile `S3ReadOnly`, unattached in any region) and **`ecr-repository-empty`** (2 empty CDK-bootstrap repositories, one per region). The remaining 3 (`sns-topic-unsubscribed`, `eventbridge-rule-no-targets`, `stepfunctions-statemachine-unused`) ran clean with no matches on this account — same "shape confirmed, live match unconfirmed" caveat as the kinds above that haven't matched yet.

**Deliberately not covered — LocalStack e2e.** The LocalStack e2e harness (`scripts/e2e-localstack.mjs`) only seeds and drives `analyze`; `dead-resources` was not added to it, and this was a decision, not an oversight (2026-07-23): LocalStack dropped its standalone open-source Community Edition in early 2026 (now a single account-based image; the free tier excludes CI credits), and per-operation emulation coverage for `DescribeReservedInstances` specifically is unconfirmed. Given the contract-fixture tests above already verify every scanner's response-shape handling, LocalStack e2e coverage was judged not worth the setup cost/uncertainty for this domain. Revisit if the LocalStack situation changes or a concrete gap surfaces that only e2e would catch.

## LocalStack e2e harness

The specs above mock the AWS SDK, so they verify the *shape* of a query but never actually run the built CLI binary against anything. [`scripts/e2e-localstack.mjs`](../../scripts/e2e-localstack.mjs) closes that gap without real AWS cost or credentials: it starts a [LocalStack](https://www.localstack.cloud/) container (`docker-compose.localstack.yml`), seeds one wasted/optimizable resource per kind (`scripts/seed-localstack.mjs`), runs the built `cloudrift analyze` against it, asserts that every expected `kind` produced a finding, and tears the container down — even on failure. It passes `--all-services` explicitly so the run always covers every scanner regardless of the [interactive picker](../adr/0041-interactive-scanner-selection-wizard.md)'s trigger logic — belt and suspenders, since `spawnSync`'s piped stdout is never a TTY anyway.

Scope is 17 of 44 scanners (see [ADR-0002](../adr/0002-localstack-e2e-scope.md), [ADR-0036](../adr/0036-ec2-underutilized-excluded-from-localstack-e2e.md), and [ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md)):

- `rds-instance`, `rds-underutilized`, `elasticache-idle`, `efs-unused` (LocalStack's free Hobby plan doesn't emulate RDS/ElastiCache/EFS) and `ec2-underutilized` (the Pricing API match it needs isn't reliable on Hobby) are excluded entirely and remain covered only by the manual AWS sandbox script below.
- The 7 scanners added in Phase 5.5 that require `--live-pricing` (`redshift-idle-cluster`, `opensearch-idle-domain`, `msk-idle-cluster`, `documentdb-idle-instance`, `neptune-idle-instance`, `mq-idle-broker`, `workspaces-idle`) are excluded entirely too: the AWS Pricing API is a real signed endpoint that doesn't work against LocalStack's fake credentials.
- `fsx-idle-filesystem` is excluded entirely: LocalStack Community rejects every FSx call outright (`"API for service 'fsx' not yet implemented or pro feature"`).
- `aurora-serverless-overprovisioned` (Phase 6.2) and `sqs-dlq-abandoned` (Phase 6.1, [ADR-0065](../adr/0065-vertical-premium-scanners-phase-6-strategy.md)) are excluded entirely: not realistically seedable/coverable on LocalStack Community, so both stay on manual verification.
- `sagemaker-notebook-idle`, `sagemaker-endpoint-idle`, and `sagemaker-training-orphaned` (Phase 6.3, [ADR-0068](../adr/0068-sagemaker-scanners-excluded-from-localstack-e2e.md)) are excluded entirely: LocalStack Community doesn't expose the `sagemaker` service at all — confirmed empirically, not just assumed from ADR-0002's RDS/ElastiCache/EFS precedent.
- `load-balancer` and `nat-gateway` are included in the expected-kinds list but treated as soft-missing — `load-balancer` because LocalStack Hobby rejects `elbv2` calls outright with a license error; `nat-gateway`'s soft status predates and is unrelated to the CloudWatch incompatibility below.
- The 3 remaining always-on Phase 5.5 scanners (`vpn-connection-idle`, `transit-gateway-idle-attachment`, `kinesis-provisioned-idle-stream`) were soft-missing because `GetMetricStatistics` failed outright on LocalStack 4.0 for every CloudWatch-backed scanner, old and new alike — see [ADR-0039](../adr/0039-cloudwatch-localstack-incompatibility.md). Fixed in [ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) by bumping the pinned image to `localstack/localstack:4.14.0`; all 3, plus the pre-existing `ebs-idle`, `lambda-underutilized`, `dynamodb-overprovisioned`, and `s3-no-lifecycle`, are hard-required again.

**Setup (one-time):** register a free account at [app.localstack.cloud](https://app.localstack.cloud) and grab your Auth Token from the dashboard — even the free Hobby plan requires one, the container refuses to start without it.

```sh
export LOCALSTACK_AUTH_TOKEN=<your-token>
pnpm nx run cli:build
pnpm nx run cli:e2e-localstack   # or: pnpm e2e:localstack
```

Requires Docker. Not wired into `lint`/`test`/`build`/`typecheck` — it's an opt-in Nx target with its own CI job (`e2e-localstack` in `.github/workflows/ci.yml`), which reads the token from the `LOCALSTACK_AUTH_TOKEN` repository secret.

### Manual inspection (table / PDF) against LocalStack

`scripts/e2e-localstack.mjs` only captures JSON to assert on it, then tears the container down — it never shows a table or generates a PDF. To actually look at a report against LocalStack data, drive the pieces by hand instead of the harness:

```sh
# 0. One-time, if not already built
pnpm nx run cli:build

# 1. Auth token (same one used by the harness)
export LOCALSTACK_AUTH_TOKEN=<your-token>

# 2. Start LocalStack and wait for it to be healthy
docker compose -f docker-compose.localstack.yml up -d --wait

# 3. Point the AWS SDK at LocalStack for this shell session
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1

# 4. Seed the wasted resources (seed-localstack.mjs is runnable standalone)
node scripts/seed-localstack.mjs

# 5. Inspect as a console table (--all-services skips the interactive scanner
#    picker, which would otherwise appear here since this runs in a real terminal)...
node apps/cli/dist/main.js analyze --regions us-east-1 --min-age-days 0 --format table --all-services

# 6. ...or as a PDF — omit a path to get the default reports/AWS_report_<date>.pdf,
#    or pass one explicitly to write it wherever you want instead:
node apps/cli/dist/main.js analyze --regions us-east-1 --min-age-days 0 --pdf --all-services
node apps/cli/dist/main.js analyze --regions us-east-1 --min-age-days 0 --pdf ./report.pdf --all-services

# 7. Repeat step 5/6 as many times as needed — the container and seeded
#    data stay put until you tear it down

# 8. Tear down when done
docker compose -f docker-compose.localstack.yml down -v
```

## Manual verification against a real AWS account

Mocked SDK calls verify the *shape* of a query; they cannot verify that the shape actually matches what AWS returns for real resources. [`scripts/verify-against-aws.mjs`](../../scripts/verify-against-aws.mjs) closes that gap: it runs 11 of the 18 scanners — everything shipped before v0.4.0 — against a real AWS account and prints what they find, next to the static query descriptor that the corresponding scanner spec already enforces in CI. The scanners added from v0.4.0 onward were never wired into this script; broader real-AWS coverage since then comes from the separate verification pass described below instead.

It is **not** run by `pnpm test` or by CI — it calls real AWS APIs and must be run by hand against a **sandbox** account.

### Seeding checklist

Create these in the sandbox account before running the script (any region, default `us-east-1`):

| Resource | What to create | Expected finding |
| --- | --- | --- |
| EBS volume | one **unattached** volume, older than 7 days | `ebs-volume` |
| Elastic IP | one **unassociated** EIP | `elastic-ip` |
| NAT Gateway | one gateway with **no traffic** for 48h | `nat-gateway` |
| EC2 instance | one instance **stopped** for more than 7 days | `ec2-instance` |
| EC2 instance | one **running** instance with low CPU for 14+ days | `ec2-underutilized` |
| EBS volume (gp2) | one **attached** gp2 volume | `ebs-gp2-upgrade` |
| EBS volume | one **attached** volume with zero I/O for 48h | `ebs-idle` |
| EBS snapshot | one snapshot whose source volume was deleted | `ebs-snapshot` |
| RDS instance | one instance **stopped** | `rds-instance` |
| RDS instance | one **available** instance with low CPU for 14+ days | `rds-underutilized` |
| Load balancer | one ALB/NLB with no registered targets | `load-balancer` |

### Running it

```sh
pnpm nx run-many -t build
CLOUDRIFT_VERIFY_AWS_SANDBOX=1 pnpm verify:aws -- --region us-east-1
```

The script refuses to run without `CLOUDRIFT_VERIFY_AWS_SANDBOX=1` (to avoid an accidental run against a default/production profile) and without resolvable AWS credentials (checked via STS `GetCallerIdentity`).

For each scanner it prints: the kind, the finding count, the total estimated monthly cost, the first 5 findings (id + reason + cost), and any error. Check by eye: `region`, `monthlyCostUsd`, `wasteReason`.

### When to run this

Once when phase 3 (the full test pyramid) lands, and afterwards only when CloudWatch filter parameters (`Namespace`, `Dimensions`, `Period`, `Statistics`) or pricing lookups change — those are the parts no mock can validate against real AWS behavior.

## Real-AWS verification status (broader than `verify-against-aws.mjs`)

As the scanner count grew well past what `verify-against-aws.mjs` covers, real-AWS verification moved to a separate deploy/validate/destroy cycle against a real AWS account (a test CDK stack in a sister repo, `cloudrift-cdk-test`, not part of this repository). This is manual, ad hoc, and not wired into CI — it exists to catch the class of bug no mock or LocalStack fixture can (wrong Pricing API `productFamily`/`instanceType` filters, boxed-`String` SDK response shapes, etc.), at a real dollar cost per run.

**Current coverage: 36 of 44 scanners have found real waste against a live AWS account** (33 original + `ami-unused`, `ecr-image-untagged`, `s3-multipart-upload-abandoned`, confirmed 2026-07-22 via the `cloudrift-cdk-test` harness). The remaining 8 split into three different kinds of gap:

- `rds-manual-snapshot-old` and `secretsmanager-unused` ran end-to-end against the same real account with zero SDK/IAM/parsing errors, but found nothing to flag: no manual RDS snapshot existed in the test account to list, and the test secret was younger than the 30-day `unusedDays` grace period. The SDK call and response-shape are confirmed live; the finding-and-policy path is not yet, since nothing matched the waste condition. Re-run once a real manual snapshot exists / the secret ages past 30 days.
- `rds-underutilized`, `ec2-underutilized`'s sibling `aurora-serverless-overprovisioned`, `sqs-dlq-abandoned`, `eks-node-overprovisioned`, and `environment-ghost` all need resources that have been running with real, organic usage patterns for 7–14 days — not something a short-lived synthetic CDK stack can produce. They require a real production-like account, not more budget on the same kind of test stack.
- `codepipeline-pipeline-stale` (added 2026-07-23, a flat $1/mo-per-pipeline fixed-at-rest cost — moved here from the dead-resources candidate list rather than treated as a $0 hygiene flag) has not yet had a real-AWS run at all; unit tests and the fixture-replay contract test are green, live verification is pending the next `cloudrift-cdk-test` cycle.

Real runs so far have found and fixed several bugs invisible to mocks — most notably a shared `PricingClient` construction bug and a boxed-`String` (`instanceof String`, not `typeof === 'string'`) parsing bug in `AwsPricingApiAdapter` that silently zeroed out every on-demand (`--live-pricing`) price. See [ADR-0058](../adr/0058-aws-client-request-timeout.md)/[ADR-0064](../adr/0064-per-client-requesthandler-not-shared.md) for the related per-client-handler pattern this class of bug follows.
