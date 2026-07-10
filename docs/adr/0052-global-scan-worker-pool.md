# ADR-0052: Global worker pool over (scanner, region) pairs in the use case

- **Status:** Accepted (2026-07-10)

## Context

`AnalyzeCloudWasteUseCase` ran the scanners with `Promise.all` across scanners while each scanner iterated its regions sequentially. That model had two problems (REVIEW.md #7):

- **Slow on multi-region scans**: total time was `regions × slowest scanner`, because a scanner could not start region N+1 before region N finished — even with idle capacity.
- **Weak as throttling protection**: the stated rationale ("don't concentrate calls on the same regional APIs") didn't hold — all 29 scanners still hit the *first* region simultaneously, with an unbounded peak (29 scans × up to ~10 internal in-flight requests each ≈ 290 potential concurrent requests).

## Decision

Every (scanner, region) pair becomes one job in a FIFO queue consumed by a small worker pool with a **single global bound**, inline in the use case (no shared helper — the application layer cannot import `mapWithConcurrency` from the infrastructure lib, and a one-off loop is small enough to live where it's used):

```typescript
const jobs = this.scanners.flatMap((scanner) =>
  request.regions.map((region) => ({ scanner, region })),
);

let nextJob = 0;
const worker = async () => {
  while (nextJob < jobs.length) {
    const { scanner, region } = jobs[nextJob++];
    // scan, collect findings/scanErrors — unchanged
  }
};
await Promise.all(Array.from({ length: workerCount }, () => worker()));
```

- `scanConcurrency` is a constructor parameter defaulting to **12** (the review suggested 10–15). The composition root doesn't pass it; tests do.
- Jobs are queued **scanner-major** (`s1×r1, s1×r2, …, s2×r1`): the first batch the workers pull spreads across regions instead of concentrating on the first one. Peak per-region load drops from 29 to ⌈12 / regions⌉ on multi-region scans, and to 12 on single-region scans.
- The FIFO pick preserves per-scanner region invocation order (a worker picks and invokes synchronously), so specs that map fake responses by call order keep working; regions of the *same* scanner may now overlap in flight — safe, since every scanner creates and destroys its SDK clients per `scan()` call and holds no mutable state across calls.

## Alternatives Considered

- **Per-region cap, regions in parallel** (e.g. max 10 in-flight per region). Makes the anti-throttling rationale literal, but total in-flight grows with the number of regions (10 × N) — the opposite of a predictable global bound. Rejected.
- **Keep as is, document the tradeoff.** Defensible for a single-region CLI run, but the model's stated rationale was already false (see Context) and multi-region scans paid real wall-clock cost. Rejected.

## Consequences

- Multi-region scan time approaches `total work / 12` instead of `regions × slowest scanner`; single-region peak load *drops* (12 concurrent scans instead of 29).
- Combined with each scanner's internal fan-out (`metricConcurrency`/`PRICING_CONCURRENCY`, ~5+5), worst-case concurrent HTTP requests are now ~12 × 10 = 120, bounded and predictable, versus ~290 before.
- `maxAttempts: 3` (ADR-0050) remains the safety net for residual throttling.
- Two new use-case tests: peak in-flight equals the configured bound; regions of the same scanner overlap when a worker is free (would deadlock under the old sequential-per-region loop).
