# Policy as Code (OPA)

> 🇮🇹 [Versione italiana](../it/policy-as-code.md)

This document is a from-zero walkthrough: what [Open Policy Agent](https://www.openpolicyagent.org/) (OPA) is, why cloudrift treats it as an external layer instead of a built-in feature, and how to actually run the example policies shipped in [`policy/`](../../policy/) against a real report. No prior OPA/Rego experience assumed.

## What this is (and isn't)

`cloudrift analyze` already has one built-in gate: set `costAlertThresholdUsd` in `cloudrift.config.json` and the command exits with code 2 when `totalWasteMonthlyUsd` goes over it (`applyCostGate` in [`analyze-waste.command.ts`](../../apps/cli/src/commands/analyze-waste.command.ts)) — enough to fail a CI job on a budget breach. See [Use in CI/CD](./ci-cd.md).

That gate can only ever compare one number to another. It cannot say "only block if the wasted resource is tagged `production`" or "block if there are more than N idle volumes, regardless of their cost." Rules like that need an actual rule engine, evaluated against the structured findings, not just a total — which is what OPA is for.

**OPA/Rego, in one paragraph:** OPA is a general-purpose policy engine. You write rules in a small language called Rego that read a piece of structured data (JSON, in our case) and decide `deny`/`allow`. It's the same tool a lot of teams already point at a Terraform plan or a Kubernetes manifest before letting it through CI. [`conftest`](https://www.conftest.dev/) is a thin CLI built on top of OPA specifically for "test this file against these Rego policies," which is exactly cloudrift's use case.

**cloudrift's role stops at producing JSON.** It doesn't run OPA, doesn't ship an OPA binary, and doesn't gain a new dependency for this. You (or your CI pipeline) run `conftest`/`opa` yourself, pointed at cloudrift's `--format json` output. Full rationale: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).

## Prerequisites

Install `conftest` — this is the tool used throughout this doc:

```sh
# macOS
brew install conftest

# other platforms: see https://www.conftest.dev/install/
```

> Raw `opa` (`brew install opa`) works too — `conftest` is a convenience wrapper around it, see [Equivalent with raw opa](#equivalent-with-raw-opa) below. You don't need both.

## Try it in 30 seconds — no AWS account needed

The repo ships a small sample report at [`policy/testdata/sample-report.json`](../../policy/testdata/sample-report.json), shaped exactly like real `cloudrift analyze --format json` output, so you can see the policies fire before touching a real account:

```sh
conftest test --policy policy policy/testdata/sample-report.json
```

Expected output — all three example policies deny something on purpose, so this fixture always fails:

```
FAIL - policy/testdata/sample-report.json - main - 3 unattached EBS volumes found, more than the 2 allowed
FAIL - policy/testdata/sample-report.json - main - ebs-volume (vol-0abc123def456) in production is wasting $40/month: unattached (state: available) for 19 days
FAIL - policy/testdata/sample-report.json - main - elastic-ip (eipalloc-0123456789abcdef0) in production is wasting $3.6/month: unassociated (no EC2/NAT binding)
FAIL - policy/testdata/sample-report.json - main - total monthly waste $63.6 exceeds budget $50
```

`--policy policy` tells conftest where to find `.rego` files (the [`policy/`](../../policy/) directory at the repo root); the last argument is the JSON file to check.

## Run it against a real report

```sh
node apps/cli/dist/main.js analyze --format json > report.json
conftest test --policy policy report.json
```

`conftest` exits `1` if any rule denied something, `0` if the report is clean — exactly the signal a CI step needs.

## What's in `policy/`

| File | Rule |
| --- | --- |
| [`waste-budget.rego`](../../policy/waste-budget.rego) | Total monthly waste over a fixed budget — the Rego version of the native `costAlertThresholdUsd` gate |
| [`production-tag.rego`](../../policy/production-tag.rego) | Any waste finding tagged `Environment: production` — per-finding, not just the total |
| [`idle-resource-count.rego`](../../policy/idle-resource-count.rego) | More than N unattached EBS volumes, regardless of their individual cost |

Each has a `_test.rego` sibling and a one-line constant documented as "the one line to edit" — see [`policy/README.md`](../../policy/README.md) for the full breakdown. Run the example test suite with:

```sh
opa test policy/ -v
```

## Writing your own rule

All three example files share `package main`, and Rego merges same-named `deny contains msg if {...}` blocks across files into a single set — so a fourth file just needs the same package header and its own condition. For example, denying any finding over $100/month regardless of tags:

```rego
# policy/high-cost-finding.rego
package main

import rego.v1

deny contains msg if {
	some finding in input.findings
	finding.category == "waste"
	finding.monthlyCostUsd > 100
	msg := sprintf("%s (%s) is wasting $%v/month", [finding.kind, finding.id, finding.monthlyCostUsd])
}
```

`input` is the parsed JSON report — see [`WasteReportDto`](../../libs/cloud-cost/application/src/dto/waste-report.dto.ts) for the full field list (`findings[].kind`, `.category`, `.tags`, `.monthlyCostUsd`, `.region`, top-level `totalWasteMonthlyUsd`, `wasteCount`, etc.).

> **One Rego gotcha worth knowing up front:** cloudrift's JSON serializes a cost that happens to be a whole dollar amount (e.g. exactly `$40`) without a decimal point. Rego's `%.2f` format verb crashes on a value like that (`%!f(int=40)`) — the example policies use `%v` instead, which prints either shape safely. Prefer `%v` over `%.2f` in your own rules unless you've confirmed the field can never be a whole number.

## Wire it into CI

Add a step after the scan, right next to the native budget gate from [Use in CI/CD](./ci-cd.md):

```yaml
      - run: node cloudrift-cli/apps/cli/dist/main.js analyze -r us-east-1 --format json > report.json
        working-directory: cloudrift-cli

      - uses: openpolicyagent/conftest-action@v1
        with:
          policy: cloudrift-cli/policy
          files: cloudrift-cli/report.json
```

(Or install `conftest` directly with the same shell steps as [Prerequisites](#prerequisites) above and run `conftest test --policy policy report.json` if you'd rather not add a marketplace action.)

## Why external, not built into the CLI

Short version: embedding an OPA runtime (a shelled-out `opa` binary or a WASM build) inside the `@cloudrift/cli` npm package would add a heavy, platform-specific dependency to get a result that — for most users — a numeric comparison already provides. The value of a real policy engine only shows up once you want expressive, multi-signal rules, or want to reuse an OPA/Rego bundle you already maintain for Terraform or Kubernetes. Keeping OPA entirely outside the package means cloudrift stays a small, dependency-light CLI, and anyone who wants this layer opts into it explicitly, in their own environment. Full decision record: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).
