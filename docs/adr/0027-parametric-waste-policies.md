# ADR-0027: Parametric waste policies instead of hardcoded heuristics

- **Status:** Accepted

## Context

A waste detector is worth as much as its false-positive rate, and the right thresholds vary by environment/account.

## Decision

Two cross-cutting CLI flags apply to every policy: `--min-age-days` (default 7) and `--ignore-tag` (default `cloudrift:ignore`). Per-check numeric thresholds (e.g. `ebsIdleMaxOps`, `ec2CpuPercent`, `rdsCpuPercent`, `lambdaInvocationsMin`, `efsIoBytesMin`, `dynamoCapacityUtilizationPercent`) are constructor parameters, configurable only via `config.thresholds` — never a dedicated CLI flag.

## Alternatives Considered

- **Expose every policy's threshold as its own CLI flag.** Rejected: would clutter `--help` with options irrelevant to most invocations (a threshold like `ec2CpuPercent` is meaningless to someone only interested in EBS volumes); the config file is the right place for advisory-check tuning knobs.

## Consequences

The CLI surface stays small and discoverable. Advanced per-check tuning lives in the config file and docs, not the flag list.
