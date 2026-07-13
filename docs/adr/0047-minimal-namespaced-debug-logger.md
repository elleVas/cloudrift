# ADR-0047: Minimal namespaced debug logger, gated by `DEBUG`, no dependency

- **Status:** Accepted (2026-07-09)

## Context

The project had no logger: `chalk`-formatted output to stdout/stderr is the user-facing report, not a diagnostic channel. This was fine for a CLI's happy path but made three ordinary questions unanswerable without adding temporary `console.log`s: how long did each scanner take, why did a given scanner return zero findings for an account that should have some, and — nothing at all sends telemetry, which is a separate, deliberate non-goal, not something this ADR addresses.

## Decision

`createLogger(namespace)` in `libs/shared/kernel/src/logging/logger.ts`: zero runtime dependencies, one method (`debug(message, meta?)`), enabled per-namespace via the `DEBUG` environment variable (`DEBUG=cloudrift:*` wildcard, an exact namespace match, or a comma-separated list of patterns — the same convention as the `debug` npm package, reimplemented rather than depended on). Output goes to **stderr**, so it never mixes with the report itself on stdout (table/JSON/PDF/markdown formats all write the report to stdout).

Two call sites at the time of this decision:

- `AnalyzeCloudWasteUseCase.execute()` (namespace `cloudrift:scanner`) logs `durationMs` and outcome (finding count, or the error) for every (scanner, region) pair — this single call site answers both "how long did each scanner take" and "why didn't it find anything," without touching any of the 29 scanner files.
- Every scanner's malformed-AWS-response filter (ADR-0051) logs how many entries it dropped and for which missing field, when the before/after count differs — otherwise-silent data loss made observable on demand.

## Alternatives Considered

- **`winston` or `pino`.** Rejected: both are structured-logging frameworks aimed at long-running services (transports, log levels beyond debug/info/warn/error, JSON output pipelines) — none of which this CLI needs. A `debug`-level namespace switch is the entire requirement.
- **Depend on the `debug` npm package directly** instead of reimplementing its namespace-matching convention. Rejected: `debug` is a fine library, but the matching logic needed (wildcard suffix, exact match, comma-separated patterns) is about 15 lines; adding a dependency (plus its own transitive footprint) for that isn't proportionate for a CLI that otherwise keeps `apps/cli`'s dependency list deliberately small (ADR-0033).

## Consequences

New `libs/shared/kernel/src/logging/logger.ts` + 7 tests (namespace matching, wildcard, multiple patterns, stderr routing, no-op when disabled). No behavior change when `DEBUG` is unset (the default): `enabled` is computed once at `createLogger()` call time and every `debug()` call short-circuits before formatting or writing anything. The existing user-facing "info" flow (`AnalysisContext.info`, chalk output) is untouched — this is a separate, opt-in diagnostic channel, not a replacement for it.

**Security note (added 2026-07-13, internal security review):** since scanner debug output includes AWS resource IDs (see the `cloudrift:scanner` call site above, and per-scanner malformed-response logs), `DEBUG=cloudrift:*` output shouldn't be pasted into a public GitHub issue or shared outside the user's organization without review — documented in the README's Development section. Not a code change: opt-in, off by default, stderr-only as designed; this is a usage caveat, not a defect.
