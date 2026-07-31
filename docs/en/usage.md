# Usage

> 🇮🇹 [Versione italiana](../it/utilizzo.md)

Flags, examples, the PDF report, partial-failure handling, and per-region pricing for `cloudrift analyze`, plus the `cost`/`trend`/`dead-resources`/`resource-security`/`history` commands and the interactive wizard.

**Interactive wizard:** running `cloudrift` with **no subcommand** in a real terminal (outside CI) launches a mode-picker wizard — choose "Find wasted resources" / "Compare spend vs. last month" / "View monthly spend trend" / "Find dead/unused resources" / "Scan for security-posture risks" / "View local scan history", then answer a few prompts (regions, which scanners, output format). It calls the exact same `analyze`/`cost`/`trend`/`dead-resources`/`resource-security`/`history` code the flags below drive, so it's never out of sync with them. Any explicit subcommand, any flag, CI, or non-interactive stdout skips the wizard entirely — scripts and pipelines are unaffected. See [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md).

**Cross-account scanning:** every command below (`analyze`, `cost`, `trend`, `dead-resources`, `resource-security`) accepts `--assume-role-arn <arn>` (optionally with `--external-id <id>`) to scan an account other than the one your ambient credentials belong to — cloudrift assumes that role via STS before making any AWS call, and the whole command fails immediately if the role can't be assumed, rather than silently falling back to your own credentials. There is no built-in "scan my whole organization" mode: to cover several accounts, invoke cloudrift once per role ARN (a shell loop or a CI matrix), each run producing its own independent report. See [ADR-0096](../adr/0096-cross-account-scanning-assume-role.md) and the "Cross-account scanning" section of [docs/en/iam-permissions.md](iam-permissions.md) for the required trust policy on the target role.

```sh
# Scan a different account by assuming a role into it
node apps/cli/dist/main.js analyze --assume-role-arn arn:aws:iam::222222222222:role/cloudrift-scanner --external-id my-shared-secret

# Sweep several accounts from a shell loop, one independent report each
for account in 111111111111 222222222222; do
  node apps/cli/dist/main.js dead-resources \
    --assume-role-arn "arn:aws:iam::${account}:role/cloudrift-scanner" \
    --format json > "report-${account}.json"
done
```

## `analyze` — find wasted resources

```sh
node apps/cli/dist/main.js analyze [options]
```

| Option                       | Description                                                                                                    | Default            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | AWS regions to scan                                                                                            | `us-east-1`        |
| `--format <format>`          | stdout output format: `table`, `json`, `markdown` (for CI / PR comments), or `csv`                            | `table`            |
| `--config <path>`            | Path to a config file (defaults to `cloudrift.config.json` / `.cloudriftrc` in the cwd)                       | auto-discovered    |
| `--live-pricing`             | Fetch current list prices from the AWS Pricing API (falls back to the static table; config prices still win)  | off (static table) |
| `--scanners <kinds...>`      | Only run these services (space-separated resource kinds, e.g. `ebs-volume elastic-ip`); skips the interactive picker | — |
| `--all-services`             | Run every scanner without the interactive picker                                                               | on in CI / non-TTY |
| `--account-id <id>`          | AWS account ID override (auto-detected via `sts:GetCallerIdentity` when omitted)                               | auto-detected      |
| `--assume-role-arn <arn>`    | Assume this IAM role via STS before scanning, for cross-account access                                        | —                  |
| `--external-id <id>`        | External ID to pass when assuming `--assume-role-arn` (only needed if the role trust policy requires one)     | —                  |
| `--min-age-days <days>`      | Grace period: resources younger than this many days are not reported (overrides config)                       | `7`                |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report (overrides config)                                   | `cloudrift:ignore` |
| `--pdf [filename]`           | Also write a PDF report to disk (defaults to `cloudrift-reports/AWS_report_YYYY_MM_DD.pdf`)                              | —                  |
| `--json [filename]`          | Also write a JSON report to disk (defaults to `cloudrift-reports/AWS_report_YYYY_MM_DD.json`)                            | —                  |
| `--csv [filename]`           | Also write a CSV report to disk (defaults to `cloudrift-reports/AWS_report_YYYY_MM_DD.csv`)                              | —                  |
| `--silent`                   | Suppress all stdout output (banner, report, confirmations) — use with `--pdf`/`--json`/`--csv` for file-only output | off                |
| `-h, --help`                 | Show help                                                                                                      | —                  |

> **stdout vs. file artifacts:** `--format` controls what goes to **stdout** (the report itself). `--json` / `--pdf` / `--csv` write **additional files** to disk and are independent of `--format` — by default the chosen `--format` still prints to stdout *in addition to* writing those files (so e.g. `--pdf` alone still shows the table by default). Add `--silent` for file-only output with nothing printed to the terminal. In machine-readable formats (`json`, `markdown`, `csv`) all human messages are routed to stderr, so stdout carries only the report — ideal for piping. Errors and the cost-gate alert always surface on stderr, even with `--silent`.
>
> **Flag order with `--pdf`/`--json`/`--csv`:** their filename is an *optional* value (`--pdf [filename]`), so it's only picked up if it immediately follows the flag — `--pdf --silent ./report.pdf` fails ("too many arguments") because `--silent` blocks `--pdf` from seeing the filename, leaving `./report.pdf` with nothing to attach to. Either keep the filename right after the flag (`--pdf ./report.pdf --silent`), or use `=` to make order irrelevant: `--pdf=./report.pdf --silent --format json`.
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

# Export a PDF report with an auto-generated filename (cloudrift-reports/AWS_report_YYYY_MM_DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Same, but with nothing printed to the terminal — just the file
node apps/cli/dist/main.js analyze --pdf ./report.pdf --silent

# Export a CSV report (e.g. to open in a spreadsheet)
node apps/cli/dist/main.js analyze --csv ./report.csv --silent

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
- **Detail pages** — one table per resource type found (EBS volumes, Elastic IPs, RDS, Load Balancers, EC2, Snapshots, NAT Gateways), each row ending in a `Link` column — click anywhere in the cell to open that exact resource in the AWS console (a handful of kinds without a derivable console URL leave it blank rather than guess, see [ADR-0091](../adr/0091-aws-console-deep-links-in-reports.md)). The same URL is available as a `consoleUrl` field on each finding in `--format json` / `--json`.
- **Scan warnings** — listed if any resource type could not be scanned

```sh
# After running with --pdf you will see:
#   Generating PDF report... saved to /path/to/cloudrift-reports/AWS_report_2026_06_09.pdf
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
| `--assume-role-arn <arn>` | Assume this IAM role via STS before scanning, for cross-account access | — |
| `--external-id <id>` | External ID to pass when assuming `--assume-role-arn` (only needed if the role trust policy requires one) | — |
| `--config <path>` | Path to a config file | auto-discovered |
| `--format <format>` | stdout format: `table`, `json`, or `csv` | `table` |
| `--fail-on-increase <pct>` | Exit with code 2 if spend increased more than this percent vs. the previous period (overrides `config.costIncreaseAlertPercent`) | off |
| `--refresh-cache` | Bypass the local Cost Explorer cache and re-fetch closed periods from AWS | off |
| `-y, --yes` | Skip the "this costs $0.01" confirmation | — |
| `--pdf [filename]` | Also write a PDF report (defaults to `cloudrift-reports/cloudrift-cost-YYYY_MM_DD.pdf`) | — |
| `--csv [filename]` | Also write a CSV report (defaults to `cloudrift-reports/cloudrift-cost-YYYY_MM_DD.csv`) | — |
| `--silent` | Suppress all stdout output | off |

**`trend`** — monthly spend over the last N calendar months (including the current partial one), rendered as an ANSI bar chart by default.

| Option | Description | Default |
| --- | --- | --- |
| `--account-id <id>` | AWS account ID override | auto-detected |
| `--assume-role-arn <arn>` | Assume this IAM role via STS before scanning, for cross-account access | — |
| `--external-id <id>` | External ID to pass when assuming `--assume-role-arn` (only needed if the role trust policy requires one) | — |
| `--config <path>` | Path to a config file | auto-discovered |
| `--months <n>` | Number of calendar months to show (1–36) | `6` |
| `--services <names...>` | Restrict to these services (shorthand like `ec2 s3 rds`, or the exact Cost Explorer service name) | all services |
| `--format <format>` | stdout format: `table` (ANSI bar chart), `json`, or `csv` | `table` |
| `--refresh-cache` | Bypass the local Cost Explorer cache | off |
| `-y, --yes` | Skip the billing confirmation | — |
| `--pdf [filename]` | Also write a PDF report (defaults to `cloudrift-reports/cloudrift-trend-YYYY_MM_DD.pdf`) | — |
| `--csv [filename]` | Also write a CSV report (defaults to `cloudrift-reports/cloudrift-trend-YYYY_MM_DD.csv`) | — |
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
| `--assume-role-arn <arn>`    | Assume this IAM role via STS before scanning, for cross-account access                                        | —                  |
| `--external-id <id>`        | External ID to pass when assuming `--assume-role-arn` (only needed if the role trust policy requires one)     | —                  |
| `--min-age-days <days>`      | Grace period: resources younger than this many days are not reported (`ec2-ri-expiring-soon` doesn't use this — see below) | `7`     |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report                                                       | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Only run these checks (space-separated, e.g. `ec2-keypair-unused iam-user-inactive`)                           | all checks          |
| `--format <format>`          | stdout output format: `table`, `json`, or `csv`                                                                | `table`            |
| `--pdf [filename]`           | Also write a PDF report to disk (defaults to `cloudrift-reports/cloudrift-dead-resources-YYYY_MM_DD.pdf`)                | —                  |
| `--csv [filename]`           | Also write a CSV report to disk (defaults to `cloudrift-reports/cloudrift-dead-resources-YYYY_MM_DD.csv`)                | —                  |
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

# CSV report, e.g. to open in a spreadsheet
node apps/cli/dist/main.js dead-resources --csv ./hygiene.csv --silent
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
| `--assume-role-arn <arn>`    | Assume this IAM role via STS before scanning, for cross-account access                                        | —                  |
| `--external-id <id>`        | External ID to pass when assuming `--assume-role-arn` (only needed if the role trust policy requires one)     | —                  |
| `--ignore-tag <tag>`         | Resources carrying this tag are excluded from the report                                                       | `cloudrift:ignore` |
| `--scanners <kinds...>`      | Only run these checks (space-separated, e.g. `iam-root-mfa-disabled s3-bucket-public`)                         | all checks          |
| `--format <format>`          | stdout output format: `table`, `json`, or `csv`                                                                | `table`            |
| `--pdf [filename]`           | Also write a PDF report to disk (defaults to `cloudrift-reports/cloudrift-resource-security-YYYY_MM_DD.pdf`)             | —                  |
| `--csv [filename]`           | Also write a CSV report to disk (defaults to `cloudrift-reports/cloudrift-resource-security-YYYY_MM_DD.csv`)             | —                  |
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

# CSV report, e.g. to open in a spreadsheet
node apps/cli/dist/main.js resource-security --csv ./security.csv --silent
```

**IAM permissions:** this command needs `iam:GetAccountSummary`, `iam:ListMFADevices`, `iam:GetAccountPasswordPolicy`, `s3:GetBucketAcl`, `s3:GetBucketPolicyStatus`, `s3:GetPublicAccessBlock`, `s3:GetBucketEncryption`, `ec2:DescribeSnapshotAttribute`, `cloudtrail:DescribeTrails` in addition to `analyze`'s policy (several other checks reuse actions already granted for `analyze`/`dead-resources`) — see [docs/en/iam-permissions.md](iam-permissions.md).

## `mcp` — run cloudrift as a local MCP server

Exposes cloudrift over stdio as an [MCP](https://modelcontextprotocol.io) server, so any MCP-compatible AI agent (Claude Desktop/Code, Kiro, VS Code Copilot Chat in Agent mode, ...) can call `analyze_cloudrift`, `get_resource_types`, and `get_required_iam_permissions` directly instead of you running the CLI by hand. It inherits the **same AWS credentials** as every other command — an agent with access to this server can see everything those credentials can see, not just waste/dead-resource/security findings.

```sh
node apps/cli/dist/main.js mcp
```

This is meant to be launched by an MCP client's config (it talks newline-delimited JSON-RPC over stdin/stdout, not something you interact with directly in a terminal).

**Disabling it:** if you don't want this machine to ever start the MCP server — even by accident, even outside any project — set `CLOUDRIFT_DISABLE_MCP=1` in your environment (shell profile, container image, or an org-wide policy). `cloudrift mcp` then refuses to start, before touching AWS credentials or reading any config file:

```sh
export CLOUDRIFT_DISABLE_MCP=1   # e.g. in ~/.zshrc or ~/.bashrc
```

This is independent of `cloudrift.config.json` on purpose: `cloudrift mcp` works from any directory, with or without a project underneath it, so a per-project config flag wouldn't cover the case of "never run this on this machine at all."

### Connecting an MCP client

See [docs/en/mcp-server.md](mcp-server.md) for the tools this server exposes and how to connect Kiro, VS Code (GitHub Copilot Chat), and Claude Code — each uses a different config format, so a file copied 1:1 from one to another will not work.

## `history` — local scan history

Reads back the local trend store: `analyze`, `dead-resources`, and `resource-security` each append a full snapshot of their own report to a per-AWS-account SQLite file (`~/.cloudrift/trends/<account-id>.db`) every time they run, best-effort and never blocking the scan itself — see [ADR-0099](../adr/0099-local-trend-store.md). `history` is the read-only command that queries it back. Nothing is ever uploaded anywhere: the file never leaves your machine.

```sh
node apps/cli/dist/main.js history [options]
```

| Option                    | Description                                                                       | Default        |
| -------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| `--account-id <id>`       | AWS account ID override (auto-detected via `sts:GetCallerIdentity` when omitted) — selects which local `.db` file to read | auto-detected   |
| `--assume-role-arn <arn>` | Assume this IAM role via STS before resolving the account ID, for cross-account access | —               |
| `--external-id <id>`     | External ID to pass when assuming `--assume-role-arn` (only needed if the role trust policy requires one) | —               |
| `--domain <domain>`      | Only show snapshots from this domain: `cloud-cost`, `dead-resources`, or `resource-security` | all domains     |
| `--limit <n>`             | Max snapshots to show, most recent first                                          | `100`           |
| `--compare <n>`           | Compare the latest run against the one `n` runs back instead of listing (requires `--domain`) | —               |
| `--html [filename]`       | Also write a self-contained HTML report with a trend chart. With `--domain`, charts just that domain (defaults to `cloudrift-reports/cloudrift-history-<domain>-YYYY_MM_DD.html`); without it, stacks all three domains on one page (defaults to `cloudrift-reports/cloudrift-history-YYYY_MM_DD.html`) | —               |
| `--format <format>`      | stdout output format: `table` or `json`                                            | `table`         |
| `-h, --help`              | Show help                                                                          | —               |

**Examples:**

```sh
# Every snapshot on record for the auto-detected account, most recent first
node apps/cli/dist/main.js history

# Only the cost-waste history, last 10 runs
node apps/cli/dist/main.js history --domain cloud-cost --limit 10

# Machine-readable output, full report payload per snapshot expanded back to JSON
node apps/cli/dist/main.js history --format json | jq '.[0].payload'

# What was I spending 5 runs ago vs. now, including a "presumed resolved" $/month figure
node apps/cli/dist/main.js history --domain cloud-cost --compare 5

# Self-contained HTML report with a line chart of waste over time
node apps/cli/dist/main.js history --domain cloud-cost --html

# Combined HTML report: all three domains stacked on one page, one chart each
node apps/cli/dist/main.js history --html
```

**No new AWS permission needed:** `history` makes the same `sts:GetCallerIdentity` call every other command already makes to resolve the account ID (skipped entirely if `--account-id` is passed explicitly) — everything else is a local file read, no AWS API call.

**Retention:** every run is kept forever, by design — there is no pruning yet. This is a deliberate simplicity choice, revisited once real-world database growth data exists (see ADR-0099's Consequences).

**`--compare`'s "presumed resolved" figure is an inference, not a confirmed saving:** cloudrift is read-only and never remediates anything, so it cannot know *why* a finding disappeared between the two compared runs (fixed by you, deleted for an unrelated reason, or simply out of this run's `--regions`/`--scanners` scope) — see [ADR-0100](../adr/0100-history-comparison-and-html-report.md).

**`--html`'s chart differs by domain:** `cloud-cost` charts a single line (monthly waste in USD), with a dashed linear-projection point one run past the last real one ("if this trend continues," not a guarantee — needs ≥2 runs), and a "top resource types by waste" list from the latest run's breakdown. `dead-resources`/`resource-security` chart three lines instead — critical/warning/info, the same severity breakdown and colors as the PDF/table reports — with a legend and a matching 3-column table, instead of one aggregate "findings" total; `resource-security` also gets a plain-language risk narrative (no dollar figure — there's no honest way to price a security finding the way AWS list prices exist for waste). The combined report (no `--domain`) additionally leads with a 3-tile executive summary (monthly waste + delta, security risk, dead-resources trend) aimed at a CTO/CEO audience who wants the headline before scrolling into any one domain.

## `iam-policy` — print the required IAM policy

```sh
node apps/cli/dist/main.js iam-policy
```

Prints the full read-only IAM policy cloudrift needs (every action across `analyze`/`dead-resources`/`resource-security`/`cost`/`trend`) as ready-to-paste JSON — the same static policy documented by hand in [docs/en/iam-permissions.md](iam-permissions.md) and returned by the `get_required_iam_permissions` MCP tool. No AWS calls, no flags, no per-command filtering (there is no per-kind IAM mapping today, so `--scanners`-style narrowing isn't available here). Useful for pasting straight into the AWS console, a Terraform `aws_iam_policy` resource, or a CDK `PolicyDocument.fromJson(...)`.
