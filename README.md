# cloudrift

<p align="center">
  <img src="docs/assets/cli-banner.png" alt="cloudrift CLI banner" />
</p>

> 🇮🇹 [Italiano](#-italiano) · 🇬🇧 [English](#-english)

---

## 🇬🇧 English

**cloudrift** is a command-line tool that scans AWS accounts for wasted resources and estimates the monthly cost of that waste.

> ⚠️ **Disclaimer:** cloudrift is a read-only analysis tool: it reports estimated waste and recommendations only — it never deletes, modifies, or stops any AWS resource. All findings should be validated by your infrastructure team before taking action. The maintainers assume no liability for actions taken based on this report.
>
> **Contact:** [raffaelevasini@gmail.com](mailto:raffaelevasini@gmail.com) · <a href="https://github.com/elleVas" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="https://www.linkedin.com/in/raffaele-vasini-87937470/" target="_blank" rel="noopener noreferrer">LinkedIn</a>

**📑 Table of contents**

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [What it detects](#what-it-detects)
- [Usage](#usage)
- [Configuration file](#configuration-file)
- [Pricing sources](#pricing-sources)
- [Use in CI/CD](#use-in-cicd)
- [Required IAM permissions](#required-iam-permissions)
- [Development](#development)
- [Releasing](#releasing)
- [Architecture](#architecture)
- [Technical documentation](#technical-documentation)
- [Adding a new resource type](#adding-a-new-resource-type)
- [License](#license)

### Prerequisites

- **Node.js 18+** — check with `node --version`
- **AWS credentials** with read-only permissions (see [Required IAM permissions](#required-iam-permissions) below)
- **pnpm** — required to build from source (`npm install -g pnpm`)

---

### Quick Start

Follow these steps in order to go from zero to seeing output.

#### Step 1 — Clone and install

```sh
git clone <repo-url>
cd cloudrift
pnpm install
```

#### Step 2 — Configure AWS credentials

Three options, in order of preference:

**Option A — AWS CLI (recommended if you already have it installed)**

```sh
aws configure
# enter: Access Key ID, Secret Access Key, default region (e.g. us-east-1), output format (json)
```

This creates `~/.aws/credentials` with the `default` profile.

**Option B — Edit `~/.aws/credentials` manually**

```ini
[default]
aws_access_key_id     = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**Option C — Environment variables**

```sh
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_DEFAULT_REGION=us-east-1
```

> **Verify:** `aws sts get-caller-identity` should return your account ID without errors.

#### Step 3 — Make sure you have the right IAM permissions

The AWS user/role must have the policy listed in [Required IAM permissions](#required-iam-permissions) below. If using an IAM user, attach it from the [IAM Console](https://console.aws.amazon.com/iam/) → User → Add permissions → Create inline policy.

#### Step 4 — Build

```sh
pnpm nx build cli
```

Output is compiled to `apps/cli/dist/`.

#### Step 5 — Run

```sh
# Scan us-east-1 (default) — the account ID is auto-detected via STS
node apps/cli/dist/main.js analyze

# Scan multiple regions
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1
```

If everything is configured correctly you'll see tables listing the wasted resources found and an estimated total cost. If the account has no wasted resources you'll see "No wasted resources found".

---

### What it detects

| Resource           | Waste condition                             | Estimated cost (us-east-1)                              |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- |
| **EBS Volumes**    | Unattached (`state: available`)             | gp3: $0.08/GB-mo · gp2: $0.10/GB-mo · io1: $0.125/GB-mo |
| **Elastic IPs**    | Unassociated (no EC2/NAT binding)           | $3.60/month fixed                                       |
| **RDS Instances**  | Stopped (still billed for storage)          | gp2/gp3: $0.115/GB-month                                |
| **Load Balancers** | No registered targets (ALB/NLB)             | ~$16.20/month fixed                                     |
| **EC2 Instances**  | Stopped — attached EBS volumes keep billing | Sum of attached EBS volumes                             |
| **EBS Snapshots**  | Source volume deleted (orphan snapshots)    | $0.05/GB-month                                          |
| **NAT Gateways**   | Zero outbound traffic in the last 48h       | ~$32.40/month fixed                                     |
| **EBS gp2→gp3**    | In-use gp2 volume upgradeable to gp3 (savings, not waste) | Saving: gp2 − gp3 price × GB (≈ $0.02/GB-mo) |
| **EBS Volumes (idle)** | Attached (in-use) but zero I/O in the last 48h | gp3: $0.08/GB-mo · gp2: $0.10/GB-mo · io1: $0.125/GB-mo |
| **EC2 Instances (underutilized)** | Running, max CPU ≤ 5% over 14 days — rightsizing candidate, requires `--live-pricing` | Saving: ~50% of the instance's monthly cost (estimate — verify RAM/network before acting) |
| **RDS Instances (underutilized)** | Available, max CPU ≤ 5% over 14 days — rightsizing candidate, requires `--live-pricing` | Saving: ~50% of the instance's monthly cost (estimate — verify storage I/O/connections before acting) |
| **CloudWatch Log Groups** | No retention policy configured (logs grow forever) | $0.03/GB-month |
| **Orphaned ENIs** | `Status: available` (not attached to any instance) | $0 (hygiene flag, not a direct cost) |
| **S3 Buckets (no lifecycle)** | No lifecycle configuration — rightsizing candidate | Saving: ~40% of Standard storage cost (estimate — verify access patterns before acting) |
| **Lambda Functions (underutilized)** | (Near-)zero invocations over 7 days | $0 (hygiene flag — pay-per-use Lambda has no direct cost when unused) |
| **EFS File Systems (unused)** | No mount targets, or mounted with zero I/O in the last 48h | $0.30/GB-month (Standard storage) |
| **DynamoDB Tables (overprovisioned)** | PROVISIONED mode, read/write capacity utilization < 10% over 7 days — rightsizing candidate | Saving: ~50% of the provisioned RCU/WCU monthly cost (estimate — verify traffic spikes before acting) |
| **ElastiCache Clusters (idle)** | Zero client connections in the last 48h, requires `--live-pricing` | Full node-hour cost (node billed regardless of usage) |
| **Redshift Clusters (idle)** | Zero database connections in the last 48h, requires `--live-pricing` | Full node-hour cost × number of nodes |
| **OpenSearch Domains (idle)** | Zero search/indexing requests in the last 48h, requires `--live-pricing` | Full instance-hour cost × instance count |
| **MSK Clusters (idle)** | Provisioned mode, zero broker traffic in the last 48h, requires `--live-pricing` | Full broker-hour cost × number of brokers |
| **FSx File Systems (idle)** | Zero read/write I/O in the last 48h | $0.093–$0.14/GB-month depending on file system type |
| **DocumentDB Instances (idle)** | Zero database connections in the last 48h, requires `--live-pricing` | Full instance-hour cost |
| **Neptune Instances (idle)** | Zero query traffic in the last 48h, requires `--live-pricing` | Full instance-hour cost |
| **Amazon MQ Brokers (idle)** | Zero network traffic in the last 48h, requires `--live-pricing` | Full broker-hour cost (×2 for ACTIVE_STANDBY_MULTI_AZ) |
| **WorkSpaces (idle)** | AlwaysOn, no user connection in the last 30 days, requires `--live-pricing` | Full bundle monthly cost |
| **Site-to-Site VPN Connections (idle)** | Zero tunnel traffic in the last 48h | ~$36.50/month fixed |
| **Transit Gateway Attachments (idle)** | Zero traffic in the last 48h | ~$36.50/month fixed |
| **Kinesis Streams (idle, Provisioned mode)** | Zero incoming records in the last 48h (On-Demand mode out of scope — pay-per-use) | ~$10.95/month per shard |

Every finding is also tagged `waste` or `optimization`: `waste` is money being spent now and feeds the headline total and the CI gate; `optimization` (gp2→gp3, EC2/RDS underutilized, S3 no-lifecycle, Lambda underutilized, DynamoDB overprovisioned) is a saving opportunity that keeps the resource, shown separately and never gated. `EC2/RDS Instances (underutilized)`, `S3 Buckets (no lifecycle)` and `DynamoDB Tables (overprovisioned)` are additionally *estimates* — verify before acting.

> **Honest caveat (Lambda):** we only check invocation count over the lookback window, nothing else. We do **not** rightsize memory allocation — that requires Lambda Insights (extra cost, must be enabled per-function), which isn't part of a zero-extra-IAM read-only scan. A function with zero invocations has, by definition, $0 direct cost (pay-per-use); the value of this finding is hygiene (dead code, unnecessary IAM roles/event sources), not a dollar saving. It also won't catch idle **Provisioned Concurrency**, which *is* billed regardless of invocations — out of scope for now.

> **Honest caveat (rightsizing):** the underutilized check is a single-metric heuristic — max CPU below a threshold over the lookback window, nothing else. It does **not** look at RAM, network throughput, IOPS or connection counts, so it can't tell you *which* smaller instance type actually fits. We do this because it requires no extra IAM permissions and works the same on every account; we don't replace [AWS Compute Optimizer](https://aws.amazon.com/compute-optimizer/), which models multiple metrics and recommends a specific target type. Treat our finding as "go check this instance," not as a sizing recommendation — cross-check with Compute Optimizer (or your own metrics) before resizing.

**False-positive guards (waste policies):**

- **Grace period** — resources younger than 7 days (configurable via `--min-age-days`) are never reported. For EC2 the stop time is reconstructed from `StateTransitionReason`; for NAT Gateways and Load Balancers the creation time is used.
- **Exclusion tag** — any resource tagged `cloudrift:ignore` (configurable via `--ignore-tag`) is skipped.
- **AMI-bound snapshots** — orphan snapshots referenced by a registered AMI are not reported (they cannot be deleted anyway).

> Prices vary by region. The tool uses region-specific pricing for: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Every report states the date the price table was last verified (`prices as of`).

> **No npm package yet.** `@cloudrift/cli` is not published on npm — the [release workflow](#releasing) exists but hasn't been triggered with a version tag. For now, build and run from source: see [Quick Start](#quick-start) above. Every command in this README uses `node apps/cli/dist/main.js …` accordingly.

---

<details>
<summary><strong>Usage</strong> — flags, examples, PDF report, partial-failure handling, per-region pricing</summary>

### Usage

```sh
node apps/cli/dist/main.js analyze [options]
```

| Option                       | Description                                                                                                    | Default            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regions...>` | AWS regions to scan                                                                                            | `us-east-1`        |
| `--format <format>`          | stdout output format: `table`, `json`, or `markdown` (for CI / PR comments)                                   | `table`            |
| `--config <path>`            | Path to a config file (defaults to `cloudrift.config.json` / `.cloudriftrc` in the cwd)                       | auto-discovered    |
| `--live-pricing`             | Fetch current list prices from the AWS Pricing API (falls back to the static table; config prices still win)  | off (static table) |
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

**Examples:**

```sh
# Scan the default region (us-east-1)
node apps/cli/dist/main.js analyze

# Scan multiple regions at once
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 ap-southeast-1

# Disable the grace period (report resources of any age)
node apps/cli/dist/main.js analyze --min-age-days 0

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

</details>

<details>
<summary><strong>Configuration file</strong> — <code>cloudrift.config.json</code> fields, overrides, false-positive tuning</summary>

### Configuration file

cloudrift reads `cloudrift.config.json` (or `.cloudriftrc`) from the current directory, or a path passed with `--config`. CLI flags take precedence over the config file, which takes precedence over the built-in defaults. All fields are optional:

> **Where does the file go?** It is **your** file, not part of the published artifact. Put `cloudrift.config.json` in the directory you run the CLI from — typically your repo root, **committed** so it's picked up automatically in CI (after `actions/checkout`) and shared by the team. Discovery is based on the current working directory, regardless of how the CLI is invoked. If the file lives elsewhere, point at it with `--config path/to/file.json`.

```json
{
  "excludeRegions": ["us-gov-east-1"],
  "excludeTagValues": { "Environment": "Production" },
  "cloudwatchWindowHours": 168,
  "utilizationWindowHours": 168,
  "minAgeDays": 14,
  "ignoreTag": "cloudrift:ignore",
  "costAlertThresholdUsd": 500,
  "prices": {
    "eu-west-1": { "nat-gateway": 28.5, "ebs-gp3": 0.07 },
    "default": { "elastic-ip": 3.2 }
  },
  "thresholds": {
    "ebsIdleMaxOps": 0,
    "ec2CpuPercent": 5,
    "rdsCpuPercent": 5
  }
}
```

| Field                     | Meaning                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `excludeRegions`          | Regions skipped even if passed via `-r`                                                          |
| `excludeTagValues`        | Exclude any resource carrying an exact `key: value` tag (e.g. don't touch `Environment: Production`) |
| `cloudwatchWindowHours`   | CloudWatch lookback window for zero-activity checks (NAT Gateway, EBS idle) (default 48, max 168 = 7 days) |
| `utilizationWindowHours`  | CloudWatch lookback window for CPU utilization checks (EC2/RDS underutilized) (default 168 = 7 days, max 336 = 14 days) |
| `minAgeDays`              | Grace period in days (same as `--min-age-days`)                                                  |
| `ignoreTag`               | Exclusion tag (same as `--ignore-tag`)                                                           |
| `costAlertThresholdUsd`   | If the **waste** total (`totalWasteMonthlyUsd`) exceeds this, the command **exits with code 2** (used to fail a pipeline); optimization savings never count toward it |
| `prices`                  | Per-region price overrides (same shape as the built-in table): `region → { priceKey: USD }`, with `default` as fallback. Use it for your **negotiated/enterprise rates** |
| `thresholds.ebsIdleMaxOps` | Total CloudWatch I/O ops below which an attached EBS volume counts as idle (default `0`)      |
| `thresholds.ec2CpuPercent` | Max CPU% below which a running EC2 instance counts as underutilized (default `5`)             |
| `thresholds.rdsCpuPercent` | Max CPU% below which an available RDS instance counts as underutilized (default `5`)          |

> A staging NAT Gateway with no weekend traffic is a classic false positive: widen `cloudwatchWindowHours` to `168` so a quiet weekend doesn't flag it.
> A batch workload that only spikes CPU once a week needs a wider `utilizationWindowHours` (up to `336`) so a quiet 7-day sample doesn't get flagged as underutilized.

</details>

<details>
<summary><strong>Pricing sources</strong> — static table, live AWS Pricing API, your overrides</summary>

### Pricing sources

Costs are resolved from three layers; the most specific wins, per `(region, priceKey)`:

1. **Your `prices` overrides** (config) — your negotiated/company rates. **Highest priority.**
2. **AWS Pricing API** (`--live-pricing`) — current public list prices, fetched at startup.
3. **Built-in static table** (`prices.json`) — always present as the fallback.

Every report shows `prices as of` (the static date, the live fetch date, or `+ custom overrides`).

> **Honest caveat:** even with `--live-pricing`, AWS returns **list** prices, not *your* bill — Savings Plans, Reserved Instances and EDP discounts are not reflected. The `prices` override is the only way to make the report match what you actually pay. Anything the live API can't unambiguously resolve falls back to the static table.

</details>

<details>
<summary><strong>Use in CI/CD</strong> — GitHub Actions example, budget gate</summary>

### Use in CI/CD

cloudrift is built to run inside pipelines, not just a terminal. Two ingredients make it CI-friendly:

1. `--format markdown` produces a Pull-Request-ready comment (totals, breakdown, top recommendations).
2. `costAlertThresholdUsd` in the config makes the command **exit 2** when waste exceeds the budget, which fails the job.

**GitHub Actions** — comment the waste report on the step summary and fail over budget. No npm package is published yet, so the CI job builds cloudrift from source on every run:

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: elleVas/cloudrift
          path: cloudrift-cli

      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm', cache-dependency-path: cloudrift-cli/pnpm-lock.yaml }

      - run: pnpm install --frozen-lockfile
        working-directory: cloudrift-cli
      - run: pnpm nx build cli
        working-directory: cloudrift-cli

      # OIDC or static keys — here static, from repo secrets
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      # Posts the markdown report to the job summary; exits 2 if over costAlertThresholdUsd
      # (cloudrift.config.json is read from the checkout of *this* repo, the cwd)
      - run: node cloudrift-cli/apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 --format markdown >> "$GITHUB_STEP_SUMMARY"
```

With a `cloudrift.config.json` committed (`{"costAlertThresholdUsd": 500}`), the last step's exit code 2 fails the check automatically — the pipeline blocks when newly created resources push waste over the threshold. Once `@cloudrift/cli` is published, the build/checkout steps collapse to a single `npx @cloudrift/cli@latest analyze …` line.

</details>

### Required IAM permissions

The AWS principal needs the following read-only permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeVolumes",
    "ec2:DescribeAddresses",
    "ec2:DescribeInstances",
    "ec2:DescribeSnapshots",
    "ec2:DescribeImages",
    "ec2:DescribeNatGateways",
    "ec2:DescribeNetworkInterfaces",
    "cloudwatch:GetMetricStatistics",
    "rds:DescribeDBInstances",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "logs:DescribeLogGroups",
    "s3:ListAllMyBuckets",
    "s3:GetBucketLifecycleConfiguration",
    "lambda:ListFunctions",
    "elasticfilesystem:DescribeFileSystems",
    "dynamodb:ListTables",
    "dynamodb:DescribeTable",
    "elasticache:DescribeCacheClusters",
    "sts:GetCallerIdentity"
  ],
  "Resource": "*"
}
```

> `--live-pricing` additionally requires `pricing:GetProducts` (the AWS Pricing API). It is **not** needed for the default static pricing.

<details>
<summary><strong>Development</strong> — watch mode, per-library tests, lint, typecheck</summary>

### Development

```sh
# Start CLI in watch mode (auto-rebuild on change)
pnpm nx serve cli

# Run all tests
pnpm nx run-many -t test

# Run a single library's tests
pnpm nx test shared-kernel
pnpm nx test cloud-cost-domain
pnpm nx test cloud-cost-application
pnpm nx test cloud-cost-infrastructure-aws-adapter

# Lint
pnpm nx run-many -t lint

# Type check
pnpm nx run-many -t typecheck
```

</details>

### Releasing

Publishing `@cloudrift/cli` to npm is automated via a tag-triggered workflow. See [docs/en/releasing.md](./docs/en/releasing.md) for the full process (one-time npm org / `NPM_TOKEN` setup, cutting a release, local verification).

### Architecture

The project uses a DDD layered architecture (Ports & Adapters) with a plugin model: every resource type is a `WasteScannerPort` implementation, and the coordinator use case is generic over the registered scanners.

```
apps/cli/                          → CLI entry point (Commander.js), presenters
libs/shared/kernel/                → Reusable base classes (Entity, ValueObject, Result)
libs/cloud-cost/domain/            → Entities, value objects, waste policies, ports
libs/cloud-cost/application/       → Generic use case + serializable report DTO
libs/cloud-cost/infrastructure/
  aws-adapter/                     → AWS SDK v3 scanners, pricing, STS account resolver
```

Dependencies always point inward: CLI → Application → Domain ← AWS Adapter.

### Technical documentation

Full documentation is in the [`docs/`](./docs/) folder — English in [`docs/en/`](./docs/en/), Italian in [`docs/it/`](./docs/it/):

| File (EN)                                                       | Content                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [docs/en/architecture.md](./docs/en/architecture.md)            | Architectural decisions, layers, multi-cloud path      |
| [docs/en/technical-choices.md](./docs/en/technical-choices.md)  | Nx, pnpm, TypeScript, AWS SDK v3, Result pattern, jest |
| [docs/en/how-it-works.md](./docs/en/how-it-works.md)            | End-to-end execution flow, code walkthrough            |
| [docs/en/adding-a-resource.md](./docs/en/adding-a-resource.md)  | Step-by-step guide to adding a new resource type       |
| [docs/en/testing.md](./docs/en/testing.md)                      | Test pyramid, where each level lives, manual AWS verification |
| [docs/en/releasing.md](./docs/en/releasing.md)                  | How `@cloudrift/cli` is built and published to npm     |

### Adding a new resource type

See [docs/en/adding-a-resource.md](./docs/en/adding-a-resource.md) for a complete walkthrough. In short:

1. Add the new kind to the `ResourceKind` union (`wasted-resource.ts`) — the compiler then points to every spot that needs updating
2. Add the entity to `libs/cloud-cost/domain/src/entities/` implementing `WastedResource`
3. Add a waste policy in `libs/cloud-cost/domain/src/policies/` (grace period and ignore tag come for free from the base class)
4. Add pricing to `PricingPort`, `StaticPriceTableAdapter` and `prices.json`
5. Implement the scanner in `libs/cloud-cost/infrastructure/aws-adapter/src/scanners/` (implements `WasteScannerPort`)
6. Add the presenter entry in `apps/cli/src/formatters/resource-presenters.ts` and register the scanner in `analyze-waste.composition.ts`

No changes to `AnalyzeCloudWasteUseCase`, the summary, or the report DTO are needed.

## License

Apache License 2.0 — see [LICENSE.md](./LICENSE.md). Free to use, modify, and distribute, including commercially.

## 🇮🇹 Italiano

**cloudrift** è uno strumento da riga di comando che scansiona account AWS alla ricerca di risorse inutilizzate e stima il costo mensile di eventuali sprechi.

> ⚠️ **Disclaimer:** cloudrift è uno strumento di analisi in sola lettura: segnala solo spreco stimato e raccomandazioni — non cancella, modifica o ferma alcuna risorsa AWS. Ogni finding deve essere validato dal tuo team infrastrutturale prima di agire. I maintainer non si assumono alcuna responsabilità per le azioni intraprese sulla base di questo report.
>
> **Contatti:** [raffaelevasini@gmail.com](mailto:raffaelevasini@gmail.com) · <a href="https://github.com/elleVas" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="https://www.linkedin.com/in/raffaele-vasini-87937470/" target="_blank" rel="noopener noreferrer">LinkedIn</a>

**📑 Indice**

- [Prerequisiti](#prerequisiti)
- [Guida rapida](#guida-rapida)
- [Cosa rileva](#cosa-rileva)
- [Utilizzo](#utilizzo)
- [File di configurazione](#file-di-configurazione)
- [Fonti dei prezzi](#fonti-dei-prezzi)
- [Uso in CI/CD](#uso-in-cicd)
- [Permessi IAM necessari](#permessi-iam-necessari)
- [Sviluppo](#sviluppo)
- [Rilascio](#rilascio)
- [Architettura](#architettura)
- [Documentazione tecnica](#documentazione-tecnica)
- [Licenza](#licenza)

### Prerequisiti

- **Node.js 18+** — verifica con `node --version`
- **Credenziali AWS** con permessi in sola lettura (vedi sezione [Permessi IAM](#permessi-iam-necessari) qui sotto)
- **pnpm** — necessario per compilare dai sorgenti (`npm install -g pnpm`)

---

### Guida rapida

Segui questi passi nell'ordine per passare da zero all'output del tool.

#### Passo 1 — Clona il repository e installa le dipendenze

```sh
git clone <repo-url>
cd cloudrift
pnpm install
```

#### Passo 2 — Configura le credenziali AWS

Hai tre opzioni, in ordine di preferenza:

**Opzione A — AWS CLI (consigliato se hai già aws cli installata)**

```sh
aws configure
# inserisci: Access Key ID, Secret Access Key, regione default (es. us-east-1), output format (json)
```

Questo crea il file `~/.aws/credentials` con il profilo `default`.

**Opzione B — File `~/.aws/credentials` manuale**

```ini
[default]
aws_access_key_id     = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**Opzione C — Variabili d'ambiente**

```sh
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_DEFAULT_REGION=us-east-1
```

> **Verifica:** `aws sts get-caller-identity` deve restituire il tuo account ID senza errori.

#### Passo 3 — Assicurati di avere i permessi IAM

L'utente/ruolo AWS deve avere la policy elencata nella sezione [Permessi IAM](#permessi-iam-necessari) qui sotto. Se usi un utente IAM, aggiungila direttamente dall'[IAM Console](https://console.aws.amazon.com/iam/) → Utente → Aggiungi permessi → Crea policy inline.

#### Passo 4 — Build

```sh
pnpm nx build cli
```

L'output viene compilato in `apps/cli/dist/`.

#### Passo 5 — Esegui

```sh
# Scansione su us-east-1 (default) — l'account ID viene rilevato automaticamente via STS
node apps/cli/dist/main.js analyze

# Scansione su più regioni
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1
```

Se tutto è configurato correttamente vedrai tabelle con le risorse sprecate trovate e il totale stimato. Se un account non ha risorse sprecate vedrai un messaggio "No wasted resources found".

---

### Cosa rileva

| Risorsa            | Condizione di spreco                                                    | Costo stimato (us-east-1)                                     |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| **EBS Volumes**    | Non attaccati a nessuna istanza (`state: available`)                    | gp3: $0,08/GB-mese · gp2: $0,10/GB-mese · io1: $0,125/GB-mese |
| **Elastic IP**     | Non associati a EC2 o NAT Gateway                                       | $3,60/mese fisso                                              |
| **RDS Instances**  | Ferme (`stopped`), ancora a pagamento per lo storage                    | gp2: $0,115/GB-mese · gp3: $0,115/GB-mese                     |
| **Load Balancers** | Nessun target registrato (ALB/NLB)                                      | ~$16,20/mese fisso                                            |
| **EC2 Instances**  | Ferme (`stopped`), i volumi EBS attaccati continuano a essere fatturati | Somma dei volumi EBS attaccati                                |
| **EBS Snapshots**  | Volume sorgente cancellato (snapshot orfani)                            | $0,05/GB-mese                                                 |
| **NAT Gateways**   | Zero traffico in uscita nelle ultime 48h                                | ~$32,40/mese fisso                                            |
| **EBS gp2→gp3**    | Volume gp2 in uso aggiornabile a gp3 (risparmio, non spreco)            | Risparmio: prezzo gp2 − gp3 × GB (≈ $0,02/GB-mese)           |
| **EBS Volumes (idle)** | Attaccati (in-use) ma zero I/O nelle ultime 48h                     | gp3: $0,08/GB-mese · gp2: $0,10/GB-mese · io1: $0,125/GB-mese |
| **EC2 Instances (underutilized)** | Running, CPU massima ≤ 5% in 14 giorni — candidato a rightsizing, richiede `--live-pricing` | Risparmio: ~50% del costo mensile dell'istanza (stima — verificare RAM/rete prima di agire) |
| **RDS Instances (underutilized)** | Disponibile (`available`), CPU massima ≤ 5% in 14 giorni — candidato a rightsizing, richiede `--live-pricing` | Risparmio: ~50% del costo mensile dell'istanza (stima — verificare storage I/O/connessioni prima di agire) |
| **CloudWatch Log Groups** | Nessuna retention policy configurata (i log crescono all'infinito) | $0,03/GB-mese |
| **ENI orfane** | `Status: available` (non attaccate a nessuna istanza) | $0 (segnalazione di igiene, non un costo diretto) |
| **S3 Buckets (no lifecycle)** | Nessuna lifecycle configuration — candidato a rightsizing | Risparmio: ~40% del costo storage Standard (stima — verificare i pattern di accesso prima di agire) |
| **Lambda Functions (underutilized)** | (Quasi) zero invocazioni in 7 giorni | $0 (segnalazione di igiene — Lambda pay-per-use non ha costo diretto se inutilizzata) |
| **EFS File Systems (unused)** | Nessun mount target, oppure montato con zero I/O nelle ultime 48h | $0,30/GB-mese (storage Standard) |
| **DynamoDB Tables (overprovisioned)** | Modalità PROVISIONED, utilizzo capacità read/write < 10% in 7 giorni — candidato a rightsizing | Risparmio: ~50% del costo mensile RCU/WCU provisioned (stima — verificare picchi di traffico prima di agire) |
| **ElastiCache Clusters (idle)** | Zero connessioni client nelle ultime 48h, richiede `--live-pricing` | Costo pieno node-hour (il nodo è fatturato indipendentemente dall'uso) |
| **Redshift Clusters (idle)** | Zero connessioni al database nelle ultime 48h, richiede `--live-pricing` | Costo pieno node-hour × numero di nodi |
| **OpenSearch Domains (idle)** | Zero richieste di ricerca/indicizzazione nelle ultime 48h, richiede `--live-pricing` | Costo pieno instance-hour × numero di istanze |
| **MSK Clusters (idle)** | Modalità Provisioned, zero traffico broker nelle ultime 48h, richiede `--live-pricing` | Costo pieno broker-hour × numero di broker |
| **FSx File Systems (idle)** | Zero I/O di lettura/scrittura nelle ultime 48h | $0,093–$0,14/GB-mese a seconda del tipo di file system |
| **DocumentDB Instances (idle)** | Zero connessioni al database nelle ultime 48h, richiede `--live-pricing` | Costo pieno instance-hour |
| **Neptune Instances (idle)** | Zero traffico di query nelle ultime 48h, richiede `--live-pricing` | Costo pieno instance-hour |
| **Amazon MQ Brokers (idle)** | Zero traffico di rete nelle ultime 48h, richiede `--live-pricing` | Costo pieno broker-hour (×2 per ACTIVE_STANDBY_MULTI_AZ) |
| **WorkSpaces (idle)** | AlwaysOn, nessuna connessione utente negli ultimi 30 giorni, richiede `--live-pricing` | Costo pieno mensile del bundle |
| **Connessioni VPN Site-to-Site (idle)** | Zero traffico nei tunnel nelle ultime 48h | ~$36,50/mese fisso |
| **Transit Gateway Attachments (idle)** | Zero traffico nelle ultime 48h | ~$36,50/mese fisso |
| **Kinesis Streams (idle, modalità Provisioned)** | Zero record in ingresso nelle ultime 48h (modalità On-Demand fuori scope — pay-per-use) | ~$10,95/mese per shard |

Ogni finding è anche etichettato `waste` o `optimization`: `waste` è denaro speso ora e contribuisce al totale principale e al gate CI; `optimization` (gp2→gp3, EC2/RDS underutilized, S3 no-lifecycle, Lambda underutilized, DynamoDB overprovisioned) è un'opportunità di risparmio che mantiene la risorsa, mostrata a parte e mai usata come gate. `EC2/RDS Instances (underutilized)`, `S3 Buckets (no lifecycle)` e `DynamoDB Tables (overprovisioned)` sono inoltre delle *stime* — da verificare prima di agire.

> **Nota onesta (Lambda):** controlliamo solo il numero di invocazioni nella finestra di osservazione, nient'altro. **Non** facciamo rightsizing della memoria — richiederebbe Lambda Insights (costo extra, da attivare per ogni funzione), fuori scope per uno scan read-only senza permessi IAM aggiuntivi. Una funzione con zero invocazioni ha per definizione $0 di costo diretto (pay-per-use); il valore di questo finding è igiene (codice morto, ruoli IAM/event source inutili), non un risparmio in dollari. Non rileva nemmeno la **Provisioned Concurrency** idle, che invece *è* fatturata indipendentemente dalle invocazioni — fuori scope per ora.

> **Nota onesta (rightsizing):** il check di sottoutilizzo è un'euristica su una singola metrica — CPU massima sotto una soglia nella finestra di osservazione, nient'altro. **Non** guarda RAM, throughput di rete, IOPS o numero di connessioni, quindi non può dirti *quale* instance type più piccolo sia davvero adatto. Lo facciamo così perché non richiede permessi IAM aggiuntivi e funziona uguale su ogni account; non sostituiamo [AWS Compute Optimizer](https://aws.amazon.com/compute-optimizer/), che modella più metriche e raccomanda un target specifico. Tratta il nostro finding come "vai a controllare questa istanza", non come una raccomandazione di sizing — verifica con Compute Optimizer (o con le tue metriche) prima di ridimensionare.

**Protezioni contro i falsi positivi (waste policies):**

- **Periodo di grazia** — le risorse più giovani di 7 giorni (configurabile con `--min-age-days`) non vengono mai segnalate. Per le EC2 la data di stop è ricostruita da `StateTransitionReason`; per NAT Gateway e Load Balancer si usa la data di creazione.
- **Tag di esclusione** — qualunque risorsa con il tag `cloudrift:ignore` (configurabile con `--ignore-tag`) viene saltata.
- **Snapshot legati ad AMI** — gli snapshot orfani referenziati da un'AMI registrata non vengono segnalati (non sarebbero comunque cancellabili).

> I prezzi variano per regione. Il tool usa prezzi specifici per: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Ogni report indica la data di ultima verifica del listino (`prices as of`).

> **Nessun pacchetto npm ancora.** `@cloudrift/cli` non è pubblicato su npm — il [workflow di rilascio](#rilascio) esiste ma non è ancora stato attivato con un tag di versione. Per ora va compilato ed eseguito dai sorgenti: vedi [Guida rapida](#guida-rapida) qui sopra. Ogni comando in questo README usa quindi `node apps/cli/dist/main.js …`.

---

<details>
<summary><strong>Utilizzo</strong> — flag, esempi, report PDF, gestione errori parziali, prezzi per regione</summary>

### Utilizzo

```sh
node apps/cli/dist/main.js analyze [opzioni]
```

| Opzione                      | Descrizione                                                                                                          | Default            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `-r, --regions <regioni...>` | Regioni AWS da scansionare                                                                                           | `us-east-1`        |
| `--format <format>`          | Formato di stdout: `table`, `json` o `markdown` (per CI / commenti PR)                                              | `table`            |
| `--config <path>`            | Percorso del file di config (default: `cloudrift.config.json` / `.cloudriftrc` nella cwd)                          | auto-rilevato      |
| `--live-pricing`             | Recupera i prezzi di listino correnti dall'AWS Pricing API (fallback alla tabella statica; i prezzi del config vincono) | off (tabella statica) |
| `--account-id <id>`          | Override dell'account ID (rilevato automaticamente via `sts:GetCallerIdentity` se omesso)                            | auto-rilevato      |
| `--min-age-days <giorni>`    | Periodo di grazia: le risorse più giovani di N giorni non vengono segnalate (ha precedenza sul config)              | `7`                |
| `--ignore-tag <tag>`         | Le risorse con questo tag vengono escluse dal report (ha precedenza sul config)                                     | `cloudrift:ignore` |
| `--pdf [filename]`           | Scrive anche un report PDF su disco (default `cloudrift-report-YYYY-MM-DD.pdf`)                                      | —                  |
| `--json [filename]`          | Scrive anche un report JSON su disco (default `cloudrift-report-YYYY-MM-DD.json`)                                   | —                  |
| `--silent`                   | Sopprime tutto l'output su stdout (banner, report, conferme) — usalo con `--pdf`/`--json` per ottenere solo il file | off                |
| `-h, --help`                 | Mostra l'help                                                                                                        | —                  |

> **stdout vs. file:** `--format` controlla cosa va su **stdout** (il report). `--json` / `--pdf` scrivono **file aggiuntivi** su disco, indipendenti da `--format` — di default il `--format` scelto continua comunque a essere stampato su stdout *in aggiunta* alla scrittura di quei file (quindi es. `--pdf` da solo mostra comunque la tabella). Aggiungi `--silent` per ottenere solo il file, senza nulla stampato a terminale. Nei formati machine-readable (`json`, `markdown`) tutti i messaggi umani vanno su stderr, così su stdout resta solo il report — ideale per il piping. Errori e l'alert della soglia di costo vanno sempre su stderr, anche con `--silent`.
>
> **Ordine dei flag con `--pdf`/`--json`:** il filename è un valore *opzionale* (`--pdf [filename]`), quindi viene raccolto solo se segue immediatamente il flag — `--pdf --silent ./report.pdf` fallisce ("too many arguments") perché `--silent` impedisce a `--pdf` di vedere il filename, lasciando `./report.pdf` senza nulla a cui agganciarsi. Tieni il filename subito dopo il flag (`--pdf ./report.pdf --silent`), oppure usa `=` per rendere l'ordine irrilevante: `--pdf=./report.pdf --silent --format json`.

**Esempi:**

```sh
# Scansione nella regione di default (us-east-1)
node apps/cli/dist/main.js analyze

# Più regioni contemporaneamente
node apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 ap-southeast-1

# Disattiva il periodo di grazia (segnala risorse di qualsiasi età)
node apps/cli/dist/main.js analyze --min-age-days 0

# Esporta un report PDF con nome automatico (reports/AWS_report_YYYY_MM_DD.pdf)
node apps/cli/dist/main.js analyze --pdf

# Come sopra, ma senza nulla stampato a terminale — solo il file
node apps/cli/dist/main.js analyze --pdf ./report.pdf --silent

# Output machine-readable (es. per una dashboard o un check CI)
node apps/cli/dist/main.js analyze --format json | jq '.totalWasteMonthlyUsd'

# Filtra i findings con jq (findings è un array flat, componibile)
node apps/cli/dist/main.js analyze --format json | jq '.findings[] | select(.category=="waste")'

# Report Markdown (es. commento PR / step summary su GitHub Actions)
node apps/cli/dist/main.js analyze --format markdown >> "$GITHUB_STEP_SUMMARY"
```

**Report PDF:**

Il flag `--pdf` genera un PDF in aggiunta all'output console (aggiungi `--silent` per sopprimere l'output console e ottenere solo il file). Il report contiene:

- **Executive summary** — totale spreco mensile e annuale, numero di risorse, breakdown per tipo
- **Top raccomandazioni** — fino a 8 voci ordinate per impatto mensile, con risparmio annuale stimato
- **Pagine di dettaglio** — una tabella per ogni tipo di risorsa trovata (EBS, Elastic IP, RDS, Load Balancer, EC2, Snapshot, NAT Gateway)
- **Scan warnings** — elencati se alcuni tipi di risorsa non hanno potuto essere scansionati

```sh
# Dopo aver eseguito con --pdf vedrai:
#   Generating PDF report... saved to /path/to/reports/AWS_report_2026_06_09.pdf
```

**Output di esempio:**

```
  Scanning us-east-1 (account 123456789012) for wasted cloud resources...

  EBS Volumes — Unattached
  ┌────────────────────┬───────────┬────────┬──────┬────────────┬────────────┐
  │ Volume ID          │ Region    │ Size   │ Type │ Created    │ Est. Cost  │
  ├────────────────────┼───────────┼────────┼──────┼────────────┼────────────┤
  │ vol-0abc123def456  │ us-east-1 │ 500 GB │ gp3  │ 2025-01-15 │ $40.00/mo  │
  └────────────────────┴───────────┴────────┴──────┴────────────┴────────────┘

  Total estimated waste: $40.00/month
```

**Comportamento in caso di errori parziali:**

Se la scansione di un tipo di risorsa fallisce (es. permessi mancanti su CloudWatch per i NAT Gateway), il tool:

- restituisce comunque tutti gli altri risultati disponibili
- mostra una sezione "Scan Warnings" con i dettagli dell'errore
- indica il totale come `(incomplete — see warnings above)`

```
  ⚠ Scan Warnings
  • NAT Gateways: Access denied to CloudWatch metrics

  Total estimated waste: $56.20/month (incomplete — see warnings above)
```

**Prezzi per regione:**

I prezzi sono per-regione (file `prices.json` nell'infrastruttura). Regioni supportate con prezzi specifici: `us-east-1`, `us-west-2`, `eu-west-1`, `eu-central-1`, `ap-southeast-1`, `ap-northeast-1`. Per le altre regioni viene usato il prezzo di default (us-east-1).

</details>

<details>
<summary><strong>File di configurazione</strong> — campi di <code>cloudrift.config.json</code>, override, tuning falsi positivi</summary>

### File di configurazione

cloudrift legge `cloudrift.config.json` (o `.cloudriftrc`) dalla directory corrente, oppure il percorso passato con `--config`. I flag CLI hanno la precedenza sul file di config, che a sua volta ha la precedenza sui default. Tutti i campi sono opzionali:

> **Dove va il file?** È un file **tuo**, non fa parte dell'artefatto pubblicato. Metti `cloudrift.config.json` nella directory da cui lanci la CLI — tipicamente la root del tuo repo, **committato** così viene preso automaticamente in CI (dopo `actions/checkout`) e condiviso dal team. La ricerca si basa sulla working directory corrente, indipendentemente da come viene invocata la CLI. Se il file sta altrove, indicalo con `--config percorso/del/file.json`.

```json
{
  "excludeRegions": ["us-gov-east-1"],
  "excludeTagValues": { "Environment": "Production" },
  "cloudwatchWindowHours": 168,
  "utilizationWindowHours": 168,
  "minAgeDays": 14,
  "ignoreTag": "cloudrift:ignore",
  "costAlertThresholdUsd": 500,
  "prices": {
    "eu-west-1": { "nat-gateway": 28.5, "ebs-gp3": 0.07 },
    "default": { "elastic-ip": 3.2 }
  },
  "thresholds": {
    "ebsIdleMaxOps": 0,
    "ec2CpuPercent": 5,
    "rdsCpuPercent": 5
  }
}
```

| Campo                     | Significato                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `excludeRegions`          | Regioni saltate anche se passate con `-r`                                                                |
| `excludeTagValues`        | Esclude le risorse con un tag `chiave: valore` esatto (es. non toccare `Environment: Production`)        |
| `cloudwatchWindowHours`   | Finestra CloudWatch per i check "zero-attività" (NAT Gateway, EBS idle) (default 48, max 168 = 7 giorni) |
| `utilizationWindowHours`  | Finestra CloudWatch per i check di utilizzo CPU (EC2/RDS underutilized) (default 168 = 7 giorni, max 336 = 14 giorni) |
| `minAgeDays`              | Periodo di grazia in giorni (come `--min-age-days`)                                                      |
| `ignoreTag`               | Tag di esclusione (come `--ignore-tag`)                                                                  |
| `costAlertThresholdUsd`   | Se il totale **waste** (`totalWasteMonthlyUsd`) supera questa soglia, il comando **esce con codice 2** (per far fallire la pipeline); i risparmi di optimization non contano mai per questo gate |
| `prices`                  | Override prezzi per regione (stessa forma del listino built-in): `regione → { chiave: USD }`, con `default` come fallback. Usalo per le tue **tariffe negoziate/aziendali** |
| `thresholds.ebsIdleMaxOps` | Operazioni I/O CloudWatch totali sotto cui un volume EBS attaccato conta come idle (default `0`)      |
| `thresholds.ec2CpuPercent` | CPU massima % sotto cui un'istanza EC2 running conta come sottoutilizzata (default `5`)                |
| `thresholds.rdsCpuPercent` | CPU massima % sotto cui un'istanza RDS disponibile conta come sottoutilizzata (default `5`)            |

> Un NAT Gateway di staging senza traffico nel weekend è il classico falso positivo: allarga `cloudwatchWindowHours` a `168` così un weekend tranquillo non lo segnala.
> Un workload batch che picca la CPU solo una volta a settimana ha bisogno di un `utilizationWindowHours` più ampio (fino a `336`) per non essere segnalato come sottoutilizzato per via di un campione di 7 giorni troppo tranquillo.

</details>

<details>
<summary><strong>Fonti dei prezzi</strong> — tabella statica, AWS Pricing API live, tuoi override</summary>

### Fonti dei prezzi

I costi sono risolti da tre livelli; vince il più specifico, per `(regione, chiave)`:

1. **I tuoi override `prices`** (config) — le tue tariffe negoziate/aziendali. **Massima priorità.**
2. **AWS Pricing API** (`--live-pricing`) — listino pubblico corrente, recuperato all'avvio.
3. **Tabella statica built-in** (`prices.json`) — sempre presente come fallback.

Ogni report mostra `prices as of` (la data dello statico, quella del fetch live, o `+ custom overrides`).

> **Nota onesta:** anche con `--live-pricing`, AWS restituisce i prezzi di **listino**, non la *tua* bolletta — Savings Plans, Reserved Instances e sconti EDP non sono riflessi. Gli override `prices` sono l'unico modo per far combaciare il report con ciò che paghi davvero. Tutto ciò che il live non riesce a risolvere in modo univoco ricade sulla tabella statica.

</details>

<details>
<summary><strong>Uso in CI/CD</strong> — esempio GitHub Actions, gate di budget</summary>

### Uso in CI/CD

cloudrift è pensato per girare dentro le pipeline, non solo nel terminale. Due ingredienti lo rendono CI-friendly:

1. `--format markdown` produce un commento pronto per le Pull Request (totali, breakdown, raccomandazioni principali).
2. `costAlertThresholdUsd` nel config fa **uscire con codice 2** quando lo spreco supera il budget, facendo fallire il job.

**GitHub Actions** — commenta il report sullo step summary e fallisci se oltre budget. Nessun pacchetto npm è ancora pubblicato, quindi il job CI compila cloudrift dai sorgenti ad ogni run:

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: elleVas/cloudrift
          path: cloudrift-cli

      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm', cache-dependency-path: cloudrift-cli/pnpm-lock.yaml }

      - run: pnpm install --frozen-lockfile
        working-directory: cloudrift-cli
      - run: pnpm nx build cli
        working-directory: cloudrift-cli

      # OIDC o chiavi statiche — qui statiche, dai secret del repo
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      # Pubblica il report markdown nel job summary; esce 2 se oltre costAlertThresholdUsd
      # (cloudrift.config.json viene letto dal checkout di *questo* repo, la cwd)
      - run: node cloudrift-cli/apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 --format markdown >> "$GITHUB_STEP_SUMMARY"
```

Con un `cloudrift.config.json` committato (`{"costAlertThresholdUsd": 500}`), il codice di uscita 2 dell'ultimo step fa fallire il check automaticamente — la pipeline si blocca quando nuove risorse spingono lo spreco oltre la soglia. Una volta pubblicato `@cloudrift/cli`, gli step di build/checkout si riducono a una singola riga `npx @cloudrift/cli@latest analyze …`.

</details>

### Permessi IAM necessari

Il principal AWS deve avere le seguenti permission in sola lettura:

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeVolumes",
    "ec2:DescribeAddresses",
    "ec2:DescribeInstances",
    "ec2:DescribeSnapshots",
    "ec2:DescribeImages",
    "ec2:DescribeNatGateways",
    "ec2:DescribeNetworkInterfaces",
    "cloudwatch:GetMetricStatistics",
    "rds:DescribeDBInstances",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "logs:DescribeLogGroups",
    "s3:ListAllMyBuckets",
    "s3:GetBucketLifecycleConfiguration",
    "lambda:ListFunctions",
    "elasticfilesystem:DescribeFileSystems",
    "dynamodb:ListTables",
    "dynamodb:DescribeTable",
    "elasticache:DescribeCacheClusters",
    "sts:GetCallerIdentity"
  ],
  "Resource": "*"
}
```

> `--live-pricing` richiede in più `pricing:GetProducts` (AWS Pricing API). **Non** serve per il pricing statico di default.

<details>
<summary><strong>Sviluppo</strong> — modalità watch, test per libreria, lint, typecheck</summary>

### Sviluppo

```sh
# Avvia la CLI in modalità watch (ricompila automaticamente)
pnpm nx serve cli

# Esegui tutti i test
pnpm nx run-many -t test

# Esegui i test di una singola libreria
pnpm nx test shared-kernel
pnpm nx test cloud-cost-domain
pnpm nx test cloud-cost-application
pnpm nx test cloud-cost-infrastructure-aws-adapter

# Lint
pnpm nx run-many -t lint

# Type check
pnpm nx run-many -t typecheck
```

</details>

### Rilascio

La pubblicazione di `@cloudrift/cli` su npm è automatica tramite un workflow attivato dai tag. Vedi [docs/it/rilascio.md](./docs/it/rilascio.md) per il processo completo (setup una tantum org npm / `NPM_TOKEN`, come pubblicare una release, verifica in locale).

### Architettura

Il progetto usa un'architettura DDD a strati (Ports & Adapters) con un modello a plugin: ogni tipo di risorsa è un'implementazione di `WasteScannerPort` e il use case coordinatore è generico sugli scanner registrati.

```
apps/cli/                          → Entry point CLI (Commander.js), presenter
libs/shared/kernel/                → Base classes riusabili (Entity, ValueObject, Result)
libs/cloud-cost/domain/            → Entità, value objects, waste policies, port
libs/cloud-cost/application/       → Use case generico + DTO serializzabile del report
libs/cloud-cost/infrastructure/
  aws-adapter/                     → Scanner AWS SDK v3, pricing, resolver account STS
```

Le dipendenze puntano sempre verso l'interno: CLI → Application → Domain ← AWS Adapter.

### Documentazione tecnica

Tutta la documentazione è nella cartella [`docs/`](./docs/) — italiano in [`docs/it/`](./docs/it/), inglese in [`docs/en/`](./docs/en/):

| File (IT)                                                            | Contenuto                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [docs/it/architettura.md](./docs/it/architettura.md)                 | Scelte architetturali, layer del sistema, percorso multi-cloud    |
| [docs/it/scelte-tecniche.md](./docs/it/scelte-tecniche.md)           | Nx, pnpm, TypeScript, AWS SDK v3, Result pattern, jest            |
| [docs/it/funzionamento.md](./docs/it/funzionamento.md)               | Flusso di esecuzione end-to-end, spiegazione del codice           |
| [docs/it/aggiungere-risorsa.md](./docs/it/aggiungere-risorsa.md)     | Guida passo per passo per aggiungere un nuovo tipo di risorsa     |
| [docs/it/test.md](./docs/it/test.md)                                 | Piramide dei test, dove vive ogni livello, verifica manuale AWS   |
| [docs/it/rilascio.md](./docs/it/rilascio.md)                         | Come `@cloudrift/cli` viene buildato e pubblicato su npm           |

## Licenza

Apache License 2.0 — vedi [LICENSE.md](./LICENSE.md). Libero da usare, modificare e distribuire, anche commercialmente.

---

