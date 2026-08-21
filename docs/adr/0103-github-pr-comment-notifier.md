# ADR-0103: GitHub PR comment as a fifth notification channel

- **Status:** Accepted (2026-08-21)

## Context

`analyze`/`dead-resources`/`resource-security`/`history --compare` already fan out to Slack, a generic webhook,
and email via `dispatchNotifications()` (`apps/cli/src/commands/notifications.ts`), each channel a small
"notifier" function in `libs/shared/notifications` (`sendSlackNotification`, `sendWebhookNotification`,
`sendEmailNotification`) taking a domain-agnostic `NotificationSummary`. `action.yml` already surfaces the
markdown report in `$GITHUB_STEP_SUMMARY`, but that only reaches someone who opens the Checks tab — it's easy
to miss on a PR with several other checks. External feedback (an AWS Ambassador-sourced review of cloudrift)
named the CI/budget-gate integration as the project's main differentiator over native AWS cost tooling; a PR
comment that surfaces the same information directly in the PR conversation was identified as the highest-value,
lowest-effort gap to close.

## Decision

Add a fifth notifier, `sendGithubPrComment` (`libs/shared/notifications/src/github-comment.notifier.ts`), posting
to `POST /repos/{owner}/{repo}/issues/{pr}/comments` via the plain GitHub REST API (`fetch`, no `@octokit`/
`@actions/github` dependency — same style as the Slack/generic-webhook notifiers). Wired into `dispatchNotifications`
as a new `--notify-github-comment` flag, added identically to `--notify-slack`/`--notify-webhook`/`--notify-email`
on all four commands, and gated by the exact same "worth reporting" condition each command already computes for
those three channels (`shouldNotifyOnCost`/`shouldNotifyOnSeverity`/`hasRegressed`) — no bespoke "did the CI gate
fail" check, to avoid a fifth channel behaving differently from the other four for no functional reason.

Context (`owner`, `repo`, `prNumber`, `token`) is resolved from the environment inside the CLI layer
(`resolveGithubPrContext()`), mirroring `resolveSmtpConfig()`:

- `GITHUB_REPOSITORY` and `GITHUB_EVENT_PATH` are exported by every Actions run automatically.
- `GITHUB_TOKEN` is not — the workflow (or `action.yml`) must forward it explicitly via `env:`.
- The PR number comes from the triggering event's own JSON payload (`GITHUB_EVENT_PATH` → `pull_request.number`),
  not by parsing `GITHUB_REF`'s `refs/pull/<n>/merge` — the payload is the documented, stable source, and this
  also means a non-`pull_request` trigger (push, cron) cleanly resolves to "skip," not a wrong PR number.

`action.yml` gained a `pr-comment` input (default `false`) that sets `--notify-github-comment` and forwards
`GITHUB_TOKEN: ${{ github.token }}` only when the input is on, documented as requiring the job to grant
`permissions: pull-requests: write` — a new, opt-in scope beyond the read-only-AWS story the Action otherwise
tells.

**Alternatives considered:**

- **A plain YAML step** (`actions/github-script` or `peter-evans/create-or-update-comment`) posting
  `steps.analyze.outputs.report` directly, no CLI code change. Rejected as the primary path: it would special-case
  GitHub as a workflow-only integration while every other channel (Slack, webhook, email) lives in the CLI's own
  Ports & Adapters-flavored notifier layer — inconsistent with the architecture, and untested by the CLI's own
  Jest suite. (Still available to anyone who'd rather not grant `pull-requests: write` to the composite action
  and wire their own step instead — `--format markdown` plus any comment-posting action works without this
  feature at all.)
- **Firing only on the literal CI-gate exit code (2)**, independent of `shouldNotifyOnCost`. Rejected: `analyze`
  is the only command with a real exit-code gate today (`applyCostGate`); `dead-resources`/`resource-security`
  have no equivalent, so a gate-exit-code condition couldn't generalize to all four commands the other channels
  already support. Reusing the existing notify condition keeps one mental model ("this channel fires exactly
  when Slack would") instead of a sixth new set of semantics.

## Consequences

Comment body is markdown, includes the full `summary.lines` (unlike Slack's deliberately title-only alert —
a PR comment isn't a shared ambient channel a busy pipeline could flood, so the "wall of text" concern that
shaped `slack-webhook.notifier.ts` doesn't apply here).

Best-effort, never-throws, same contract as every other notifier: a missing token, a closed PR, or a GitHub API
error logs a warning and never fails the scan.

New tests: `github-comment.notifier.spec.ts` (7 cases) and `notifications.spec.ts` additions (4 cases covering
the dispatch/skip/failure paths). Verified: `shared-notifications` and `cli` typecheck, lint, and full test
suites green.
