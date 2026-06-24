# ADR-0006: Disclaimer/contact as top-level DTO fields, not under `meta`

- **Status:** Accepted (2026-06-22)

## Context

`WasteReportDto` needed new fields to carry the disclaimer and contact info introduced in [ADR-0005](0005-disclaimer-contact-in-application-layer.md).

## Decision

Add `disclaimer` and `contact` as **top-level** fields on `WasteReportDto`.

## Alternatives Considered

- **Nest them under the existing `meta` object.** Rejected: several existing tests assert on the exact shape of `dto.meta`; nesting unrelated new fields there would force touching every one of those tests for a reason unrelated to what they're testing.

## Consequences

`WasteReportDto` has a slightly flatter shape than it might otherwise have. Existing `meta`-shaped tests were left untouched.
