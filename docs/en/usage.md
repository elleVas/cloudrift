# Usage

> 🇮🇹 [Versione italiana](../it/utilizzo.md)

Flags, examples, the PDF report, partial-failure handling, and per-region pricing for `cloudrift analyze`, plus the `cost`/`trend` commands and the interactive wizard.

**Interactive wizard:** running `cloudrift` with **no subcommand** in a real terminal (outside CI) launches a mode-picker wizard — choose "Find wasted resources" / "Compare spend vs. last month" / "View monthly spend trend", then answer a few prompts (regions, which scanners, output format). It calls the exact same `analyze`/`cost`/`trend` code the flags below drive, so it's never out of sync with them. Any explicit subcommand, any flag, CI, or non-interactive stdout skips the wizard entirely — scripts and pipelines are unaffected. See [ADR-0071](../adr/0071-unified-entry-wizard-bare-invocation.md).

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
