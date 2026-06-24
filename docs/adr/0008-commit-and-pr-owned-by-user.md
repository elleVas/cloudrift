# ADR-0008: Commit and PR always owned by the user

- **Status:** Accepted (v0.4.0 phase 4.1), still in effect

## Context

Established during the phase-by-phase v0.4.0 workflow: each phase (one branch/PR) needed a clear handoff point between assistant-driven implementation and user-driven git history.

## Decision

The assistant implements and verifies (`pnpm nx run-many -t lint,test,build,typecheck`), then stages changes for review with `git add .` — not `git add -A`. The user always makes the commit and opens the PR; the assistant never commits or opens a PR autonomously.

## Alternatives Considered

- **Let the assistant commit and open PRs directly to speed up the loop.** Rejected: the user wants a manual checkpoint before anything becomes part of git history or GitHub.
- **Use `git add -A` for staging.** Rejected explicitly by the user after phase 4.1: `-A` stages the entire repo including paths outside the current working scope, while `git add .` is scoped to the current directory and below — the more conservative default for review staging. In this repo (always worked from the root) the two are nearly equivalent in practice, but `git add .` is used for consistency with the stated preference.

## Consequences

Every phase ends with staged-but-uncommitted changes. Commit messages, PR descriptions, and the decision of *when* to commit are always the user's.
