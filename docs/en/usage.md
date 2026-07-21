# Usage

> 🇮🇹 [Versione italiana](../it/utilizzo.md)

Flags, examples, the PDF report, partial-failure handling, and per-region pricing for `cloudrift analyze`.

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
