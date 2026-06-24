# ADR-0035: Report output is always in English

- **Status:** Accepted (2026-06-22)

## Context

Development conversations with the assistant happen in Italian, but the tool's reports are a product artifact with a broader, mixed-language audience.

## Decision

Every user-facing output — PDF, JSON, markdown, stdout/stderr — stays English-only, regardless of the language used during development. Verified by grepping for common Italian words and elisions (not just accented characters — plain words like "viene", "questo", "sono" pass undetected by an accent-only grep) across all formatters.

## Alternatives Considered

- **Localize output (e.g. an Italian report option).** Rejected: not requested, and would double the maintenance surface (plus ongoing translation upkeep) for a niche audience compared to a single canonical English output.

## Consequences

Any new formatter or user-facing string must be authored in English from the start. The verification method here — a broad word-list grep, not just accented characters — is the standard check to reuse for any future IT→EN audit.
