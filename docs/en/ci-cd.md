# Use in CI/CD

> 🇮🇹 [Versione italiana](../it/ci-cd.md)

GitHub Actions examples and the budget gate.

cloudrift is built to run inside pipelines, not just a terminal. Two ingredients make it CI-friendly:

1. `--format markdown` produces a Pull-Request-ready comment (totals, breakdown, top recommendations).
2. `costAlertThresholdUsd` in the config (see [Configuration file](./configuration.md)) makes the command **exit 2** when waste exceeds the budget, which fails the job.

**GitHub Actions — as a reusable action.** [`action.yml`](../../action.yml) at the repo root wraps `npm install -g @cloudrift/cli` + `cloudrift analyze`, posts the markdown report to the job summary, and fails the job on the same exit codes as the CLI (`2` = over budget). It installs `@cloudrift/cli` from npm under the hood, so it only works once the package is published — until then, use the source-build example below.

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # for cloudrift.config.json, read from the cwd

      # OIDC or static keys — here static, from repo secrets
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - uses: elleVas/cloudrift@v0.5.0
        with:
          regions: us-east-1 eu-west-1
          config: cloudrift.config.json
```

With a `cloudrift.config.json` committed (`{"costAlertThresholdUsd": 500}`), the action fails the check automatically when waste exceeds the budget — the pipeline blocks when newly created resources push it over the threshold. See `action.yml` for every input (`live-pricing`, `scanners`, `min-age-days`, `ignore-tag`, `pdf`, `json`, `format`, `version`, …) and the `report`/`exit-code` outputs.

**GitHub Actions — building from source (works today, before the action/npm package are published):**

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

With a `cloudrift.config.json` committed (`{"costAlertThresholdUsd": 500}`), the last step's exit code 2 fails the check automatically — the pipeline blocks when newly created resources push waste over the threshold.

## Policy as Code (OPA)

The `costAlertThresholdUsd` gate above is a single total-vs-budget comparison. For anything more specific — per-tag, per-resource-kind, per-count rules — cloudrift ships example [Open Policy Agent](https://www.openpolicyagent.org/) policies you evaluate against its JSON output, in your own pipeline. cloudrift never runs OPA itself; it only ever produces JSON, exactly as it already does.

```sh
node apps/cli/dist/main.js analyze --format json > report.json
conftest test --policy policy report.json
```

See [docs/en/policy-as-code.md](./policy-as-code.md) for a from-zero walkthrough and [policy/README.md](../../policy/README.md) for what each example policy checks. Rationale for keeping this external to the CLI: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).
