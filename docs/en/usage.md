# Usage

> 🇮🇹 [Versione italiana](../it/utilizzo.md)

Flags, examples, the PDF report, partial-failure handling, and per-region pricing for `cloudrift analyze`, plus the `cost`/`trend`/`dead-resources`/`resource-security` commands and the interactive wizard.

**Interactive wizard:** running `cloudrift` with **no subcommand** in a real terminal (outside CI) launches a mode-picker wizard — choose "Find wasted resources" / "Compare spend vs. last month" / "View monthly spend trend" / "Find dead/unused resources" / "Scan for security-posture risks", then answer a few prompts (regions, which scanners, output format). It calls the exact same `analyze`/`cost`/`trend`/`dead-resources`/`resource-security` code the flags below drive, so it's never out of sync with them. Any explicit subcommand, any flag, CI, or non-interactive stdout skips the wizard entirely — scripts and pipelines are unaffected. See [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md).

## `analyze` — find wasted resources

```sh
node apps/cli/dist/main.js analyze [options]
```

| Option                       | Description                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | AWS regions to scan                                                                                            | `us-east-1`        |
| `--format <format>`          | stdout output format: `table`, `json`, or `markdown` (for CI / PR comments)                                   | `table`            |
| `--config <path>`            | Path to a config file (defaults to `cloudrift.config.json` / `.cloudriftrc` in the cwd)                       | auto-discovered    |
| `--live-pricing`             | Fetch current list prices from the AWS Pricing API (falls back to the static table; config prices still win)  | off (static table) |
| `--scanners <kinds...>`      | Only run these services (space-separated resource kinds, e.g. `ebs-volume elastic-ip`); skips the interactive picker | — |
| `--all-services`             | Run every scanner without the interactive picker                                                               | on in CI / non-TTY |
| `--account-id <id>`          | AWS account ID override (auto-detected via `sts:GetCallerIdentity` when omitted)                               | auto-detected      |
| `--min-age-days <days>`      | Grace period: resources younger than this many days are not reported (overrides config)                       | `7`                |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report (overrides config)                                   | `cloudrift:ignore` |
| `--pdf [filename]`           | Also write a PDF report to disk (defaults to `cloudrift-report-YYYY-MM-DD.pdf`)                                | —                  |
| `--json [filename]`          | Also write a JSON report to disk (defaults to `cloudrift-report-YYYY-MM-DD.json`)                              | —                  |
| `--silent`                   | Suppress all stdout output (banner, report, confirmations) — use with `--pdf`/`--json` for file-only output    | off                |
| `-h, --help`                 | Show help                                                                                                      | —                  |

> **stdout vs. file artifacts:** `--format` controls what goes to **stdout** (the report itself). `--json` / `--pdf` write **additional files** to disk and are independent of `--format` — by default the chosen `--format` still prints to stdout *in addition to* writing those files (so e.g. `--pdf` alone still shows the table by default). Add `--silent` for file-only output with nothing printed to the terminal. In machine-readable formats (`json`, `markdown`) all human messages are routed to stderr, so stdout carries only the report — ideal for piping. Errors and the cost-gate alert always surface on stderr, even with `--silent`.
>
> **Flag order with `--pdf`/`--json`:** their filename is an *optional* value (`--pdf [filename]`), so it's only picked up if it immediately follows the flag — `--pdf --silent ./report.pdf` fails ("too many arguments") because `--silent` blocks `--pdf` from seeing the filename, leaving `./report.pdf` with nothing to attach to. Either keep the filename right after the flag (`--pdf ./report.pdf --silent`), or use `=` to make order irrelevant: `--pdf=./report.pdf --silent --format json`.
>
> **Choosing which services to scan:** running `analyze` in a real terminal (and outside CI) shows an interactive picker — a checkbox list of every scanner, all pre-selected, so pressing Enter immediately scans everything like before. Deselect what you don't need, or skip the picker entirely with `--scanners <kinds...>` (an explicit list) or `--all-services` (scan everything, no prompt). In CI or whenever stdout isn't a terminal, the picker never appears and every scanner runs by default — automation is never blocked waiting on input.

**Examples:**

```sh
# Scan the default region (us-east-1)
node apps/cli/dist/main.js analyze

# Scan multiple regions at once
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 ap-southeast-1

# Disable the grace period (report resources of any age)
node apps/cli/dist/main.js analyze --min-age-days 0

# Only scan EBS volumes and Elastic IPs, skipping the interactive picker
node apps/cli/dist/main.js analyze --scanners ebs-volume elastic-ip

# Scan everything without the interactive picker (e.g. in a script run from a terminal)
node apps/cli/dist/main.js analyze --all-services

# Export a PDF report with an auto-generated filename (reports/AWS_report_YYYY_MM_DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Same, but with nothing printed to the terminal — just the file
node apps/cli/dist/main.js analyze --pdf ./report.pdf --silent

# Machine-readable output (e.g. to feed a dashboard or CI check)
node apps/cli/dist/main.js analyze --format json | jq '.totalWasteMonthlyUsd'

# Filter findings with jq (findings is a flat array, fully composable)
node apps/cli/dist/main.js analyze --format json | jq '.findings[] | select(.category=="waste")'

# Markdown report (e.g. a GitHub Actions PR comment / step summary)
node apps/cli/dist/main.js analyze --format markdown >> "$GITHUB_STEP_SUMMARY"
```

**PDF report:**

The `--pdf` flag generates a PDF alongside the normal console output (add `--silent` to suppress the console output and get only the file). The report contains:

- **Executive summary** — monthly and annual waste totals, resource count, per-type breakdown
- **Top recommendations** — up to 8 items sorted by monthly savings potential, with estimated annual saving
- **Detail pages** — one table per resource type found (EBS volumes, Elastic IPs, RDS, Load Balancers, EC2, Snapshots, NAT Gateways)
- **Scan warnings** — listed if any resource type could not be scanned

```sh
# After running with --pdf you will see:
#   Generating PDF report... saved to /path/to/reports/AWS_report_2026_06_09.pdf
```

**Partial failure handling:**

If scanning a resource type fails (e.g. missing CloudWatch permissions for NAT Gateways), the tool:

- still returns all other results
- displays a "Scan Warnings" section with the error details
- marks the total as `(incomplete — see warnings above)`

```
  ⚠ Scan Warnings
  • NAT Gateways: Access denied to CloudWatch metrics

  Total estimated waste: $56.20/month (incomplete — see warnings above)
```

**Per-region pricing:**

Prices are region-aware (defined in `prices.json` in the infrastructure layer). Regions with explicit pricing: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. All other regions fall back to us-east-1 defaults.

---

## `cost` / `trend` — spend comparison and monthly trend

> ⚠️ **These two commands call AWS Cost Explorer, which bills $0.01 per request** — the only commands in cloudrift that can incur an AWS charge (every scanner in `analyze` uses free describe/list calls). Both ask for interactive confirmation before the first call unless you pass `-y`/`--yes`, `--silent`, or run outside a TTY/in CI. Closed billing periods are cached on disk (`~/.cloudrift/cache/cost-explorer/`) so re-running the same command for the same dates doesn't bill you again — see [ADR-0069](../adr/0069-cost-explorer-integration-billed-api-confirmation.md) / [ADR-0070](../adr/0070-cost-explorer-disk-cache-decorator.md).

Cost Explorer is a single global endpoint — unlike `analyze`, neither command takes a `--regions` flag.

```sh
node apps/cli/dist/main.js cost [options]
node apps/cli/dist/main.js trend [options]
```

**`cost`** — current spend (1st of this month through today) vs. the same day-of-month range last month, broken down by service.

| Option | Description | Default |
| --- | --- | --- |
| `--account-id <id>` | AWS account ID override (auto-detected via STS when omitted) | auto-detected |
| `--config <path>` | Path to a config file | auto-discovered |
| `--format <format>` | stdout format: `table` or `json` | `table` |
| `--fail-on-increase <pct>` | Exit with code 2 if spend increased more than this percent vs. the previous period (overrides `config.costIncreaseAlertPercent`) | off |
| `--refresh-cache` | Bypass the local Cost Explorer cache and re-fetch closed periods from AWS | off |
| `-y, --yes` | Skip the "this costs $0.01" confirmation | — |
| `--pdf [filename]` | Also write a PDF report (defaults to `reports/cloudrift-cost-YYYY_MM_DD.pdf`) | — |
| `--silent` | Suppress all stdout output | off |

**`trend`** — monthly spend over the last N calendar months (including the current partial one), rendered as an ANSI bar chart by default.

| Option | Description | Default |
| --- | --- | --- |
| `--account-id <id>` | AWS account ID override | auto-detected |
| `--config <path>` | Path to a config file | auto-discovered |
| `--months <n>` | Number of calendar months to show (1–36) | `6` |
| `--services <names...>` | Restrict to these services (shorthand like `ec2 s3 rds`, or the exact Cost Explorer service name) | all services |
| `--format <format>` | stdout format: `table` (ANSI bar chart) or `json` | `table` |
| `--refresh-cache` | Bypass the local Cost Explorer cache | off |
| `-y, --yes` | Skip the billing confirmation | — |
| `--pdf [filename]` | Also write a PDF report (defaults to `reports/cloudrift-trend-YYYY_MM_DD.pdf`) | — |
| `--silent` | Suppress all stdout output | off |

**Examples:**

```sh
# Compare this month's spend so far against the same days last month
node apps/cli/dist/main.js cost

# Fail CI if spend is up more than 20% vs. the previous period
node apps/cli/dist/main.js cost --fail-on-increase 20 --format json

# Last 12 months, EC2 and S3 only, skip the confirmation prompt (already scripted)
node apps/cli/dist/main.js trend --months 12 --services ec2 s3 --yes

# Re-fetch even already-cached closed periods
node apps/cli/dist/main.js trend --refresh-cache
```

---

## `dead-resources` — dead/unused resource hygiene

A separate hygiene domain from `analyze`'s cost-waste model, deliberately — see [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md). Finds things left dead or unused in the account with **no direct AWS cost** (so `analyze`'s cost-based criteria can never catch them): unused EC2 key pairs and security groups, expiring Reserved Instances, inactive IAM users/roles, stale access keys, unattached IAM policies and instance profiles, empty CloudWatch log groups, orphaned CloudWatch alarms, unused ACM certificates, empty Route53 hosted zones, stuck CloudFormation stacks, empty S3 buckets, SNS topics with no subscriptions, EventBridge rules with no targets, empty ECR repositories, and never-executed Step Functions state machines — 18 checks in total. Findings carry a `severity` (`info` / `warning` / `critical`) instead of a `$/month` estimate.

```sh
node apps/cli/dist/main.js dead-resources [options]
```

| Option                       | Description                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | AWS regions to scan (ignored by the global-scope checks — see below)                                           | `us-east-1`        |
| `--account-id <id>`          | AWS account ID override (auto-detected via `sts:GetCallerIdentity` when omitted)                               | auto-detected      |
| `--min-age-days <days>`      | Grace period: resources younger than this many days are not reported (`ec2-ri-expiring-soon` doesn't use this — see below) | `7`     |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report                                                       | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Only run these checks (space-separated, e.g. `ec2-keypair-unused iam-user-inactive`)                           | all checks          |
| `--format <format>`          | stdout output format: `table` or `json`                                                                        | `table`            |
| `--pdf [filename]`           | Also write a PDF report to disk (defaults to `reports/cloudrift-dead-resources-YYYY_MM_DD.pdf`)                | —                  |
| `--silent`                   | Suppress all stdout output (banner, report). Errors still surface.                                              | off                |
| `-h, --help`                 | Show help                                                                                                       | —                  |

**Checks:**

| Kind | Scope | What's flagged | Severity | Threshold |
| --- | --- | --- | --- | --- |
| `ec2-keypair-unused` | regional | EC2 key pair not referenced by any running/stopped instance's `KeyName` | `info` | 7-day grace period (`--min-age-days`) since the key pair's own creation date |
| `ec2-ri-expiring-soon` | regional | Active Reserved Instance whose term ends within the threshold | `warning` | 30 days (not configurable via a flag today — see [ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md) for why this doesn't reuse `--min-age-days`) |
| `ec2-security-group-unused` | regional | Security group not referenced by any network interface (the account/VPC's `default` group is always excluded) | `info` | none — no creation date is exposed by the API to base a grace period on |
| `logs-loggroup-empty` | regional | CloudWatch log group that has never stored any events (`storedBytes === 0`) | `info` | 7-day grace period (`--min-age-days`) |
| `acm-certificate-unused` | regional | ACM certificate not attached to any AWS resource (`InUse` computed by AWS itself) | `info` | 7-day grace period (`--min-age-days`) |
| `cloudformation-stack-stuck` | regional | Stack stuck in `CREATE_FAILED` / `ROLLBACK_FAILED` / `DELETE_FAILED` / `UPDATE_ROLLBACK_FAILED` | `critical` | 7-day grace period (`--min-age-days`) |
| `cloudwatch-alarm-orphaned` | regional | Alarm stuck in `INSUFFICIENT_DATA` — usually the metric's underlying resource was deleted | `warning` | 7-day grace period (`--min-age-days`), measured from the alarm's last configuration update |
| `iam-user-inactive` | global | No console login and no access-key usage within the threshold (or ever) | `warning` | 90 days (CIS AWS Foundations Benchmark's own figure), 7-day creation grace period |
| `iam-policy-unattached` | global | Customer-managed IAM policy with zero attachments (AWS-managed policies excluded server-side — you can't delete those anyway) | `info` | 7-day grace period (`--min-age-days`) |
| `iam-role-unused` | global | No role assumption within the threshold (or ever); AWS service-linked roles are excluded | `warning` | 90 days, 7-day creation grace period |
| `iam-access-key-stale` | global | Active access key not rotated within the threshold — CIS AWS Foundations Benchmark's rotation control | `warning` | 90 days |
| `route53-hostedzone-empty` | global | Hosted zone with no records beyond the default NS/SOA pair (`ResourceRecordSetCount <= 2`) | `info` | none — no creation date is exposed by the API to base a grace period on |
| `s3-bucket-empty` | global | Bucket with zero objects | `info` | 7-day grace period (`--min-age-days`) |

> **IAM, Route53, and (for this command) S3 are global AWS services.** The six `global` checks above run **once per scan**, never once per requested region — unlike the seven `regional` checks. See [ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md).

**Examples:**

```sh
# Every check, default region
node apps/cli/dist/main.js dead-resources

# Multiple regions — only affects the regional checks, not the global ones
node apps/cli/dist/main.js dead-resources -r us-east-1 eu-west-1

# Only the IAM checks
node apps/cli/dist/main.js dead-resources --scanners iam-user-inactive iam-policy-unattached

# Machine-readable output
node apps/cli/dist/main.js dead-resources --format json | jq '.findings[] | select(.severity=="warning")'

# PDF report, nothing printed to the terminal
node apps/cli/dist/main.js dead-resources --pdf ./hygiene.pdf --silent
```

**IAM permissions:** this command needs `ec2:DescribeKeyPairs`, `ec2:DescribeReservedInstances`, `ec2:DescribeSecurityGroups`, `iam:ListUsers`, `iam:ListAccessKeys`, `iam:GetAccessKeyLastUsed`, `iam:ListPolicies`, `iam:ListRoles`, `logs:DescribeLogGroups`, `acm:ListCertificates`, `route53:ListHostedZones`, `cloudformation:DescribeStacks`, `s3:ListAllMyBuckets`, `s3:ListBucket`, `cloudwatch:DescribeAlarms` in addition to `analyze`'s policy — see [docs/en/iam-permissions.md](iam-permissions.md).

---

## `resource-security` — security-posture scan

A separate domain from both `analyze`'s cost-waste model and `dead-resources`' hygiene model — see [ADR-0081](../adr/0081-resource-security-parallel-domain.md). Finds risky **configuration** on resources that are actively in use (unlike `dead-resources`, which finds abandoned ones): disabled root/user MFA, overdue access-key rotation, active root access keys, a weak or missing account password policy, security groups with ingress open to the internet on sensitive ports, permissive default security groups, public S3 buckets and EBS snapshots, unencrypted EBS volumes and RDS instances, S3 buckets with no default encryption, publicly accessible RDS instances, and accounts with no multi-region CloudTrail trail — 14 checks in total, all backed by read-only `Describe*`/`Get*`/`List*` API calls. Findings carry a `severity` (`info` / `warning` / `critical`), same shape as `dead-resources`; there is no `--min-age-days` grace period — a security misconfiguration is a risk from the moment it exists, not after it ages.

```sh
node apps/cli/dist/main.js resource-security [options]
```

| Option                       | Description                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | AWS regions to scan (ignored by the global-scope checks — see below)                                           | `us-east-1`        |
| `--account-id <id>`          | AWS account ID override (auto-detected via `sts:GetCallerIdentity` when omitted)                               | auto-detected      |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report                                                       | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Only run these checks (space-separated, e.g. `iam-root-mfa-disabled s3-bucket-public`)                         | all checks          |
| `--format <format>`          | stdout output format: `table` or `json`                                                                        | `table`            |
| `--pdf [filename]`           | Also write a PDF report to disk (defaults to `reports/cloudrift-resource-security-YYYY_MM_DD.pdf`)             | —                  |
| `--silent`                   | Suppress all stdout output (banner, report). Errors still surface.                                              | off                |
| `-h, --help`                 | Show help                                                                                                       | —                  |

**Checks:**

| Kind | Scope | What's flagged | Severity |
| --- | --- | --- | --- |
| `iam-root-mfa-disabled` | global | Root account has no MFA device enabled | `critical` |
| `iam-user-mfa-disabled` | global | IAM user with no MFA device registered | `warning` |
| `iam-access-key-rotation-overdue` | global | Active access key older than 90 days (CIS AWS Foundations 1.14) | `warning` |
| `iam-root-access-key-active` | global | Root account has at least one active access key | `critical` |
| `iam-password-policy-weak` | global | Account password policy missing, or short of the CIS baseline (14-char minimum, all character classes, ≤90-day max age, 24-password reuse prevention) | `warning` |
| `ec2-security-group-open-ingress` | regional | Security group with ingress open to `0.0.0.0/0`/`::/0` on a sensitive port (SSH, RDP, common database ports) | `critical` |
| `ec2-default-security-group-permissive` | regional | A VPC's `default` security group still carries ingress and/or egress rules | `warning` |
| `s3-bucket-public` | global | Bucket reachable by the internet via its ACL and/or bucket policy | `critical` |
| `ec2-snapshot-public` | regional | EBS snapshot with `createVolumePermission` granted to the `all` group | `critical` |
| `ec2-volume-unencrypted` | regional | EBS volume not encrypted at rest | `warning` |
| `rds-instance-unencrypted` | regional | RDS instance storage not encrypted at rest | `warning` |
| `s3-bucket-encryption-missing` | global | Bucket with no default server-side encryption configured | `warning` |
| `rds-instance-publicly-accessible` | regional | RDS instance reachable from outside its VPC | `critical` |
| `cloudtrail-not-multiregion` | global | No CloudTrail trail configured with multi-region logging | `warning` |

> **IAM, S3 (bucket listing), and CloudTrail are treated as global for this command.** The eight `global` checks above run **once per scan**, never once per requested region — unlike the six `regional` checks. See [ADR-0081](../adr/0081-resource-security-parallel-domain.md).

**Examples:**

```sh
# Every check, default region
node apps/cli/dist/main.js resource-security

# Multiple regions — only affects the regional checks, not the global ones
node apps/cli/dist/main.js resource-security -r us-east-1 eu-west-1

# Only the IAM checks
node apps/cli/dist/main.js resource-security --scanners iam-root-mfa-disabled iam-user-mfa-disabled

# Machine-readable output
node apps/cli/dist/main.js resource-security --format json | jq '.findings[] | select(.severity=="critical")'

# PDF report, nothing printed to the terminal
node apps/cli/dist/main.js resource-security --pdf ./security.pdf --silent
```

**IAM permissions:** this command needs `iam:GetAccountSummary`, `iam:ListMFADevices`, `iam:GetAccountPasswordPolicy`, `s3:GetBucketAcl`, `s3:GetBucketPolicyStatus`, `s3:GetPublicAccessBlock`, `s3:GetBucketEncryption`, `ec2:DescribeSnapshotAttribute`, `cloudtrail:DescribeTrails` in addition to `analyze`'s policy (several other checks reuse actions already granted for `analyze`/`dead-resources`) — see [docs/en/iam-permissions.md](iam-permissions.md).
