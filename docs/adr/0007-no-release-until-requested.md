# ADR-0007: No version bump/tag/publish until explicitly requested

- **Status:** Accepted (2026-06-21), still in effect

## Context

v0.4.0's 7 scanners reached feature-complete with `lint`/`test`/`build`/`typecheck` green, which could be mistaken for "ready to release."

## Decision

Hold off on bumping the version, tagging, or publishing to npm until the user explicitly asks for it, regardless of how complete or green the work is.

## Alternatives Considered

- **Auto-bump/tag at the end of each completed phase.** Rejected: releases are a user-owned decision point (timing, changelog wording, npm account, public visibility), not something to automate silently just because CI is green.

## Consequences

Completed work can sit on a branch/PR for a while without being "released." "Tests pass" must never be treated as equivalent to "ready to publish."
</content>
