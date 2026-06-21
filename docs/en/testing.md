# Testing

> 🇮🇹 [Versione italiana](../it/test.md)

This document describes the test pyramid for cloudrift: what each level covers, where to find concrete examples, and how to manually verify scanners against a real AWS sandbox account.

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

One spec per scanner under [`libs/cloud-cost/infrastructure/aws-adapter/src/scanners/`](../../libs/cloud-cost/infrastructure/aws-adapter/src/scanners/), with the AWS SDK client mocked. Each covers: the candidate filter (e.g. `DescribeVolumes` with `Filters=[status=available]`), pagination, concurrency, SDK errors, and `destroy()` on the client. Nine scanners are CloudWatch-based (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`, `aws-efs-unused`, `aws-lambda-underutilized`, `aws-s3-no-lifecycle`, `aws-dynamodb-overprovisioned`, `aws-elasticache-idle`) and additionally assert the exact `Namespace`, `Period`, `Statistics` and `Dimensions` sent to `GetMetricStatistics` — this is the contract the manual verification script below leans on for the four it currently covers (`aws-ebs-idle`, `aws-ec2-underutilized`, `aws-nat-gateway`, `aws-rds-underutilized`); the other five aren't wired into that script yet.

### CLI e2e

[`apps/cli/src/commands/analyze-waste.command.spec.ts`](../../apps/cli/src/commands/analyze-waste.command.spec.ts) drives the command with a fake `AnalyzeDeps` (no AWS), asserting format selection (table/json/markdown), exit codes (0/1/2), the `--json <file>` and `--pdf <file>` artifacts, and that a partial scan (`summary.scanErrors` non-empty) doesn't crash the command — the exit code stays driven only by the cost threshold, never by scan errors, and the incomplete-scan note (produced by the formatters, see [`waste-report.markdown-formatter.spec.ts`](../../apps/cli/src/formatters/waste-report.markdown-formatter.spec.ts)) reaches stdout. `analyze-waste.composition.ts` — the `defaultAnalyzeDeps` implementation the fake stands in for — has no spec of its own by design: it only wires real AWS adapters together (same pattern as `aws-account-id.resolver.ts`), and that wiring is exactly what the fake is meant to bypass in unit tests.

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
