# ADR-0029: `Result<T, E>` instead of exceptions, including for user input

- **Status:** Accepted

## Context

JavaScript exceptions are untyped; the CLI needs to handle expected failures (bad region code, AWS errors) cleanly and consistently.

## Decision

An explicit `Result<T, E>` type is used across layer boundaries instead of throwing — including for user input. `AwsRegion.parse()` returns `Result<AwsRegion, InvalidAwsRegionError>` and is the path the CLI uses to validate `-r`. A throwing `AwsRegion.create()` also exists, but is reserved for codes known at compile time (typically test fixtures) — external input never goes through it.

## Alternatives Considered

- **Use exceptions with a top-level try/catch in the CLI entry point.** Rejected: the type system can't force callers to handle a thrown error; `Result` makes handling mandatory at the type level and composes simply (a failure propagates or is collected as a value).

## Consequences

Expected failures produce a clean message and exit code 1, with no stack trace. The throwing `create()` path is reserved and documented as test-fixture-only, so it's never accidentally reached with real external input.
</content>
