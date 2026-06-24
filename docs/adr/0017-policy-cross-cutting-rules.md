# ADR-0017: Two cross-cutting rules in every `WastePolicy`

- **Status:** Accepted

## Context

A naive "state === available" style check produces false positives for resources that are simply very recent (just detached, just created) or intentionally kept.

## Decision

The `WastePolicy<T>` base class applies two rules before any type-specific criterion runs: an exclusion tag (`cloudrift:ignore`, configurable via `--ignore-tag`) and a grace period (`minAgeDays`, default 7, via `--min-age-days`).

## Alternatives Considered

- **Let each policy implement its own age/tag check independently.** Rejected: guarantees inconsistent behavior and duplicated logic across 18 policies, and a bug fix in one would not propagate to the others.

## Consequences

Every new policy gets both protections for free by extending the base class. The two CLI flags (`--min-age-days`, `--ignore-tag`) behave consistently across all scanners.
