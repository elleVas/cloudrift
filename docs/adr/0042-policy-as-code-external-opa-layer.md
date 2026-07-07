# ADR-0042: Policy-as-Code via an external OPA layer, not an embedded Rego engine

- **Status:** Accepted (2026-07-08)

## Context

cloudrift already has one gating mechanism: `applyCostGate` in [`analyze-waste.command.ts`](../../apps/cli/src/commands/analyze-waste.command.ts) sets `process.exitCode = 2` when `config.costAlertThresholdUsd` is set and `totalWasteMonthlyUsd` exceeds it. It is a single scalar comparison against the report total — it cannot express per-finding, per-tag, per-kind, or per-count rules (e.g. "block only if a wasted resource is tagged `production`", "block if there are more than N idle volumes regardless of their cost").

On 2026-06-25 the user approved, in principle, pushing cloudrift's "Policy-as-Code" positioning further with [Open Policy Agent](https://www.openpolicyagent.org/) (OPA), with an explicit constraint: as an external layer, not an OPA/Rego runtime embedded in the npm package. This was deferred until the rest of the v0.5.0 backlog closed; work started 2026-07-08.

## Decision

Ship example policies and documentation, with no changes to `apps/cli` and no new runtime dependency:

- A top-level [`policy/`](../../policy/) directory with three example `.rego` policies (budget total, per-finding tag, per-kind count), each with a matching `*_test.rego` unit test file (OPA's built-in test framework) and a bundled `testdata/sample-report.json` fixture shaped like real `WasteReportDto` JSON, so the examples are runnable with zero AWS setup.
- Bilingual walkthrough docs, [`docs/en/policy-as-code.md`](../en/policy-as-code.md) / [`docs/it/policy-as-code.md`](../it/policy-as-code.md), written for a reader with no prior OPA/Rego experience.
- A "Policy as Code (OPA)" section in the main README, next to the existing "Use in CI/CD" section.

cloudrift's own output is unchanged: it still only ever produces JSON via `--format json`. The user (or their CI pipeline) evaluates that JSON against the example (or their own) `.rego` policies using their own [`conftest`](https://www.conftest.dev/)/`opa` install — cloudrift never shells out to or bundles either tool.

## Alternatives Considered

- **Embed an OPA runtime in the CLI** (shelled-out `opa` binary, or a WASM build compiled into `@cloudrift/cli`). Rejected: a heavy, platform-specific dependency, for a result that — for the common case of "compare a total to a budget" — the existing native gate already provides. The only scenario where an embedded engine would add value (expressive, multi-signal policies) is exactly the scenario where the user already has their own OPA/Rego tooling and workflow to plug into, making embedding redundant rather than convenient.
- **Do nothing beyond the native gate.** Rejected: doesn't serve users who want per-tag/per-kind/per-count rules, or who want to reuse an existing organizational Rego bundle (e.g. the same policies already applied to Terraform plans) against cloudrift's findings too.

## Consequences

New top-level `policy/` directory (three `.rego` policies + tests + fixture + `policy/README.md`), two new doc pages (`docs/en/policy-as-code.md`, `docs/it/policy-as-code.md`), and one new README section (EN + IT). No new npm dependency, no `apps/cli` code change, no change to cloudrift's own CI workflows — evaluation happens entirely in the end user's own environment/pipeline. `opa` and `conftest` were installed locally (via `brew`) only to verify the shipped example policies evaluate correctly before publishing them; neither is a project dependency.
