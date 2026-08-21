# ADR-0104: `history --format markdown` + `actions/cache` for a trend summary in CI

- **Status:** Accepted (2026-08-21)

## Context

The local trend store (ADR-0099) writes to `~/.cloudrift/trends/<account-id>.db`. That's durable on a
developer's machine, but a GitHub-hosted runner's home directory is torn down at the end of every job — so
`history`'s local scan history never accumulates across CI runs, only within a single one. `action.yml`
already surfaces the current run's report in `$GITHUB_STEP_SUMMARY` (`step-summary` input) and, as of
ADR-0103, optionally as a PR comment, but neither shows how waste is trending over time — exactly the
follow-on gap identified alongside the PR-comment work (same AWS Ambassador-sourced review that flagged the
CI integration as cloudrift's main differentiator).

## Decision

Two independent pieces:

**1. `history --format markdown`** (`trend-history.markdown-formatter.ts`), a third format alongside the
existing `table`/`json`. Renders a Unicode block sparkline (`▁▂▃▄▅▆▇█`, one char per run, oldest→newest)
plus a Markdown table of the same rows `formatTrendHistoryAsTable` already knows how to summarize (date,
domain, findings, monthly waste) — `summarize()` was exported out of the table formatter rather than
duplicated. Deliberately **not** supported together with `--compare`: that flag's two-run diff has no
Markdown renderer of its own yet, and the plain listing already works from a single stored run (no minimum
history requirement), which is what the CI use case actually needs. Chosen over reusing `--html`'s inline-SVG
line chart: GitHub's job-summary Markdown sanitizer strips `<svg>`/`<script>`, so the HTML report's chart
would not survive being pasted into a step summary — a plain-text sparkline is the one "chart" shape
guaranteed to render.

**2. `action.yml`'s new `trend-summary` input**, wiring `actions/cache` around the existing `analyze` step:

- `actions/cache/restore@v4` before `analyze`, keyed `cloudrift-trends-<account-id>-<run_id>` (deliberately
  unique, so it never hits on its own) with `restore-keys: cloudrift-trends-<account-id>-` as a prefix match —
  the standard "ever-growing history" idiom for `actions/cache`, needed because a cache entry can never be
  overwritten once its exact key exists (an exact stable key would work exactly once, then silently stop
  updating).
- A new `Append trend summary` step (`if: always()`, so it still runs when `analyze` failed the budget gate)
  running `cloudrift history --domain cloud-cost --format markdown >> $GITHUB_STEP_SUMMARY || true` —
  best-effort, same as the PR-comment channel: a trend summary must never fail the job it's decorating.
- `actions/cache/save@v4` after that, same unique key, so this run's updated trend store becomes the next
  run's restore target.

Cross-branch/fork isolation is **not** hand-implemented: GitHub Actions' cache backend already scopes reads
to the current branch, the PR's base branch, and the repo's default branch, and a forked-repository PR
physically cannot write to the upstream repo's cache (its `GITHUB_TOKEN` has no access) — building extra key
scoping on top would duplicate a guarantee the platform already provides, so `trend-summary` needs no
`permissions:` entry beyond the Action's existing default (`contents: read`), unlike `pr-comment`'s
`pull-requests: write`.

**Alternatives considered:**

- **Reusing `--html`'s inline SVG chart** in the summary. Rejected: GitHub's job-summary sanitizer strips
  `<svg>`, so it wouldn't render — confirmed against GitHub's documented Markdown-rendering behavior for job
  summaries, not tested against a live run (no CI harness for `action.yml` itself, see Consequences).
- **A durable branch- or S3-backed store** instead of `actions/cache`. Rejected for this first cut: both
  need either `contents: write` (a branch-committed history) or customer-provisioned AWS storage with its own
  IAM policy — in tension with the Action's read-only, minimal-permission positioning. `actions/cache`'s
  eviction (7 days unused, or oldest-evicted past a 10GB repo-wide cap) is an accepted trade-off, not a gap to
  close later unless a real user hits it.

## Consequences

New tests: `trend-history.markdown-formatter.spec.ts` (sparkline edge cases — empty, single point, flat
series — plus the rendered table/caption), and `history.command.spec.ts` additions (`--format markdown`
plain-list output, and the `--compare` + `--format markdown` rejection). `shared-notifications`/`cli`
typecheck, lint, and full test suites green.

`action.yml`'s new steps are **not** covered by any test — there is no harness that runs the composite action
itself (LocalStack e2e only drives the built CLI binary, never a GitHub Actions runner). The cache
restore/save/scoping behavior described above is verified against GitHub's documented `actions/cache`
semantics, not exercised live, until the next real workflow run using `trend-summary: true` on
`github.com/elleVas/cloudrift` itself or a consumer repo.
