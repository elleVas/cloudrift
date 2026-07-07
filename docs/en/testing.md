# Testing

> 🇮🇹 [Versione italiana](../it/test.md)

This document describes the test pyramid for cloudrift: what each level covers, where to find concrete examples, how to run the LocalStack e2e harness, and how to manually verify scanners against a real AWS sandbox account.

## The pyramid

```
        ┌─────────────────────────┐
        │   CLI e2e (apps/cli)    │   command-level: format, exit code, artifacts
        ├─────────────────────────┤
        │  Infra (scanner specs)  │   AWS SDK mocked: query shape, pagination, errors
        ├─────────────────────────┤
        │  Domain (entity/policy) │   pure logic: waste rules, boundaries, no I/O
        └─────────────────────────┘
        ┌─────────────────────────┐
        │  LocalStack e2e (free)  │   scripts/e2e-localstack.mjs (this doc), 16/29 scanners
        ├─────────────────────────┤
        │  Manual AWS sandbox     │   scripts/verify-against-aws.mjs (this doc)
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

Policies live in one file, [`libs/cloud-cost/domain/src/policies/resource-waste-policies.spec.ts`](../../libs/cloud-cost/domain/src/policies/resource-waste-policies.spec.ts), covering for every policy: waste vs not-waste, the grace period, the `ignoreTag`, `excludeTagValues`, and the exact boundary of each threshold (age `===` `minAgeDays`, CPU `===` threshold, ops `===` `maxOps`) — boundaries matter because grace-period and CPU/ops comparisons use opposite-strictness operators (`<` vs `>=`/`>`), so an off-by-one there silently changes which resources get flagged.

### Infra — scanners

One spec per scanner under [`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/), with the AWS SDK client mocked. Each covers: the candidate filter (e.g. `DescribeVolumes` with `Filters=[status=available]`), pagination, concurrency, SDK errors, and `destroy()` on the client. Nineteen scanners are CloudWatch-based — the original nine (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`, `aws-efs-unused`, `aws-lambda-underutilized`, `aws-s3-no-lifecycle`, `aws-dynamodb-overprovisioned`, `aws-elasticache-idle`) plus ten added in Phase 5.5 (`aws-fsx-idle`, `aws-redshift-idle`, `aws-opensearch-idle`, `aws-msk-idle`, `aws-documentdb-idle`, `aws-neptune-idle`, `aws-mq-idle`, `aws-vpn-connection-idle`, `aws-transit-gateway-idle`, `aws-kinesis-idle`; `aws-workspaces-idle` is the one Phase 5.5 scanner that is *not* CloudWatch-based, it polls `DescribeWorkspacesConnectionStatus` instead) — and additionally assert the exact `Namespace`, `Period`, `Statistics` and `Dimensions` sent to `GetMetricStatistics`. This is the contract both the manual verification script below (currently covering four: `aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`) and the LocalStack e2e harness lean on; [ADR-0039](../adr/0039-cloudwatch-localstack-incompatibility.md)/[ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) found and then fixed `GetMetricStatistics` failing against LocalStack 4.0 for every one of these nineteen scanners, so the e2e harness now actually exercises the CloudWatch request/response path, not just the unit-tested request shape.

### CLI e2e

[`apps/cli/src/commands/analyze-waste.command.spec.ts`](../../apps/cli/src/commands/analyze-waste.command.spec.ts) drives the command with a fake `AnalyzeDeps` (no AWS), asserting format selection (table/json/markdown), exit codes (0/1/2), the `--json <file>` and `--pdf <file>` artifacts, and that a partial scan (`summary.scanErrors` non-empty) doesn't crash the command — the exit code stays driven only by the cost threshold, never by scan errors, and the incomplete-scan note (produced by the formatters, see [`waste-report.markdown-formatter.spec.ts`](../../apps/cli/src/formatters/waste-report.markdown-formatter.spec.ts)) reaches stdout. `analyze-waste.composition.ts` — the `defaultAnalyzeDeps` implementation the fake stands in for — has no spec of its own by design: it only wires real AWS adapters together (same pattern as `aws-account-id.resolver.ts`), and that wiring is exactly what the fake is meant to bypass in unit tests.

## LocalStack e2e harness

The specs above mock the AWS SDK, so they verify the *shape* of a query but never actually run the built CLI binary against anything. [`scripts/e2e-localstack.mjs`](../../scripts/e2e-localstack.mjs) closes that gap without real AWS cost or credentials: it starts a [LocalStack](https://www.localstack.cloud/) container (`docker-compose.localstack.yml`), seeds one wasted/optimizable resource per kind (`scripts/seed-localstack.mjs`), runs the built `cloudrift analyze` against it, asserts that every expected `kind` produced a finding, and tears the container down — even on failure. It passes `--all-services` explicitly so the run always covers every scanner regardless of the [interactive picker](../adr/0041-interactive-scanner-selection-wizard.md)'s trigger logic — belt and suspenders, since `spawnSync`'s piped stdout is never a TTY anyway.

Scope is 16 of 29 scanners (see [ADR-0002](../adr/0002-localstack-e2e-scope.md), [ADR-0036](../adr/0036-ec2-underutilized-excluded-from-localstack-e2e.md), and [ADR-0040](../adr/0040-localstack-bumped-4-14-0-cloudwatch-fixed.md)):

- `rds-instance`, `rds-underutilized`, `elasticache-idle`, `efs-unused` (LocalStack's free Hobby plan doesn't emulate RDS/ElastiCache/EFS) and `ec2-underutilized` (the Pricing API match it needs isn't reliable on Hobby) are excluded entirely and remain covered only by the manual AWS sandbox script below.
- The 7 scanners added in Phase 5.5 that require `--live-pricing` (`redshift-idle-cluster`, `opensearch-idle-domain`, `msk-idle-cluster`, `documentdb-idle-instance`, `neptune-idle-instance`, `mq-idle-broker`, `workspaces-idle`) are excluded entirely too: the AWS Pricing API is a real signed endpoint that doesn't work against LocalStack's fake credentials.
- `fsx-idle-filesystem` is excluded entirely: LocalStack Community rejects every FSx call outright (`"API for service 'fsx' not yet implemented or pro feature"`).
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

Mocked SDK calls verify the *shape* of a query; they cannot verify that the shape actually matches what AWS returns for real resources. [`scripts/verify-against-aws.mjs`](../../scripts/verify-against-aws.mjs) closes that gap: it runs 11 of the 18 scanners — everything shipped before v0.4.0 — against a real AWS account and prints what they find, next to the static query descriptor that the corresponding scanner spec already enforces in CI. The 7 scanners added in v0.4.0 (`log-group`, `eni-orphaned`, `s3-no-lifecycle`, `lambda-underutilized`, `efs-unused`, `dynamodb-overprovisioned`, `elasticache-idle`) aren't wired into this script yet.

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
