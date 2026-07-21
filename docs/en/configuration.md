# Configuration file

> 🇮🇹 [Versione italiana](../it/configurazione.md)

`cloudrift.config.json` fields, overrides, and false-positive tuning.

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
