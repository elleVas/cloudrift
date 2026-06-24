# ADR-0018: Scan errors collected per (scanner, region) pair

- **Status:** Accepted

## Context

A single missing IAM permission in one region shouldn't take down the whole report.

## Decision

Errors are collected as `ResourceScanError { kind, region, error }`. The summary is always returned with whatever partial data succeeded, plus the error list in `scanErrors`.

## Alternatives Considered

- **Fail the whole scan (or the whole region) on the first error.** Rejected: one denied permission for one scanner in one region would hide every otherwise-successful finding from every other scanner and region.

## Consequences

Users see a partial report plus explicit warnings instead of an opaque failure. Error granularity is deliberately fine — per (scanner, region) pair, not per run or per region alone.
</content>
