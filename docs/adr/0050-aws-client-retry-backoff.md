# ADR-0050: AWS SDK clients get `maxAttempts: 3` by default, everywhere

- **Status:** Accepted (2026-07-09)

## Context

No scanner configured retry behavior on its AWS SDK v3 client — every `new XClient({ region: region.code })` used the SDK's bare default. On an account with many resources, 29 scanners scanning N regions produce a large number of API calls in a short window; AWS throttling (HTTP 429) on any single one of them failed that scanner for that region outright, surfaced to the user as a scan error rather than being transparently retried, even though AWS SDK v3 ships a built-in exponential-backoff retry strategy that only needs a `maxAttempts` option to activate.

## Decision

`AWS_CLIENT_DEFAULTS = { maxAttempts: 3 } as const` in `libs/cloud-cost/infrastructure/aws-adapter/src/utils/client-config.ts`, spread into every SDK client construction across all 29 scanners:

```typescript
const client = new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
```

`maxAttempts: 3` turns on the SDK's built-in exponential backoff with jitter for transient throttling (429) and server errors (5xx) — no custom retry logic, just the option the SDK already supports.

## Alternatives Considered

- **A custom retry wrapper around `client.send()`.** Rejected: the SDK's built-in strategy already implements exponential backoff with jitter correctly; a hand-rolled version would duplicate that logic for no behavioral gain and would need its own tests for correctness the SDK's implementation already has.
- **A higher `maxAttempts` (e.g. 5).** Considered. 3 was chosen as a middle ground: enough to absorb a transient throttle without the scanner appearing to hang on an account experiencing sustained, non-transient throttling (a real permissions or service-availability problem retrying 5 times wouldn't fix, only delay the useful error).

## Consequences

Every one of the 29 `new XClient(...)` call sites was updated to spread `AWS_CLIENT_DEFAULTS` first (so a per-scanner override, if one is ever needed, can still follow and win). No test changes needed: the mocked-SDK scanner specs don't assert on client construction options, only on the commands sent through `client.send()`. `docs/en/technical-choices.md` and `docs/en/adding-a-resource.md` document the pattern as a required rule for any new scanner.
