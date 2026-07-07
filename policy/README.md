# Example Open Policy Agent policies

Three small [Rego](https://www.openpolicyagent.org/docs/latest/policy-language/) policies that evaluate cloudrift's JSON report (`analyze --format json`) and deny when a rule is broken. cloudrift itself never runs these — you evaluate them yourself with [`conftest`](https://www.conftest.dev/) or [`opa`](https://www.openpolicyagent.org/), in your own shell or CI pipeline. See [docs/en/policy-as-code.md](../docs/en/policy-as-code.md) (or [docs/it/policy-as-code.md](../docs/it/policy-as-code.md)) for a full walkthrough starting from zero OPA experience, and [ADR-0042](../docs/adr/0042-policy-as-code-external-opa-layer.md) for why this is a separate layer instead of something built into the CLI.

All three files share `package main` so a single `conftest test`/`opa eval` picks up every rule at once — Rego merges `deny contains msg if {...}` blocks with the same name across files into one set.

| File | Checks | The one line to edit |
| --- | --- | --- |
| [`waste-budget.rego`](./waste-budget.rego) | `totalWasteMonthlyUsd` against a fixed budget — the same rule cloudrift's own `costAlertThresholdUsd` gate already enforces natively, written in Rego as a starting point | `budget_usd` |
| [`production-tag.rego`](./production-tag.rego) | Any individual **waste** finding tagged `Environment: production` — something the native gate can't express, since it only ever looks at the total | the tag key/value on line 11 |
| [`idle-resource-count.rego`](./idle-resource-count.rego) | The *number* of `ebs-volume` findings, not their cost — flags "too many idle volumes" even if each one is cheap | `max_idle_ebs_volumes` |

Each `*.rego` file has a matching `*_test.rego` using OPA's built-in test framework. Run them with:

```sh
opa test policy/ -v
```

## Try it against the bundled fixture

[`testdata/sample-report.json`](./testdata/sample-report.json) is a small, hand-written report (3 EBS volumes + 1 Elastic IP, one of them tagged `production`) shaped exactly like real `cloudrift analyze --format json` output, so you can try every rule immediately with no AWS account:

```sh
conftest test --policy policy policy/testdata/sample-report.json
```

All three rules are written to trigger against this fixture on purpose, so you'll see:

```
FAIL - policy/testdata/sample-report.json - main - 3 unattached EBS volumes found, more than the 2 allowed
FAIL - policy/testdata/sample-report.json - main - ebs-volume (vol-0abc123def456) in production is wasting $40/month: unattached (state: available) for 19 days
FAIL - policy/testdata/sample-report.json - main - elastic-ip (eipalloc-0123456789abcdef0) in production is wasting $3.6/month: unassociated (no EC2/NAT binding)
FAIL - policy/testdata/sample-report.json - main - total monthly waste $63.6 exceeds budget $50
```

`conftest` exits non-zero whenever `deny` is non-empty — that's what fails a CI job.

## Run it against a real report

```sh
node apps/cli/dist/main.js analyze --format json > report.json
conftest test --policy policy report.json
```

## Equivalent with raw `opa`

`conftest` is a thin, purpose-built wrapper around `opa eval` for exactly this "structured file + Rego policy → pass/fail" shape. The same check with the underlying tool:

```sh
opa eval --data policy --input report.json 'data.main.deny' --format pretty
```

A non-empty array means at least one rule fired.
