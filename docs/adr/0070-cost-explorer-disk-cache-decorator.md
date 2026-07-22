# ADR-0070: Cost Explorer responses cached on disk via a decorator, only once a period is safely closed

- **Status:** Accepted (2026-07-22)

## Context

Unlike every other adapter in this codebase (free describe/list calls, safe to re-run at will), `AwsCostExplorerAdapter` ([ADR-0069](0069-cost-explorer-integration-billed-api-confirmation.md)) bills $0.01 per request. A user re-running `cost`/`trend` — to change `--format`, add `--pdf`, or just because they forgot the first output — would otherwise pay again for data that, for any date range fully in the past, cannot have changed.

## Decision

`CachedCostExplorerAdapter` (`libs/cloud-cost/infrastructure/aws-adapter/src/cost-explorer/cost-explorer-cache.adapter.ts`) wraps a real `CostExplorerPort` as a **decorator**, not a modification to `AwsCostExplorerAdapter` itself:

```typescript
export class CachedCostExplorerAdapter implements CostExplorerPort {
  constructor(
    private readonly inner: CostExplorerPort,
    private readonly accountId: string,
    private readonly options: { cacheDir?: string; refresh?: boolean; now?: () => Date } = {},
  ) {}
}
```

Wired in by default in `cost-analytics.composition.ts`: `new CachedCostExplorerAdapter(new AwsCostExplorerAdapter(), accountId, { refresh: refreshCache })`.

A whole query's response is cached on disk, keyed by its exact parameters (`~/.cloudrift/cache/cost-explorer/<accountId>/<granularity>_<start>_<end>.json`) — **but only once every bucket in the requested range is safely closed**: `isRangeSafelyClosed()` requires the range's end date to be more than **2 days** in the past, per AWS's own documented reconciliation lag (Cost Explorer can still finalize/adjust the most recent 24–48h of data even for a calendar day that has technically ended). A range touching the current, still-open billing period is never cached and always hits the real API.

`--refresh-cache` bypasses the cache entirely and re-fetches (still respecting the same cacheable/non-cacheable split — it doesn't cache an in-progress period either). A cache write failure (read-only filesystem, permissions) is swallowed silently: the cache is a pure cost optimization, never allowed to fail the command itself.

## Alternatives Considered

- **In-memory cache, process lifetime only.** Rejected: does nothing for the actual repeat-invocation case (a user re-running the CLI a minute later, or the next day) — the billing waste this ADR exists to prevent happens across process runs, not within one.
- **Cache everything, including the open period, with a short TTL.** Rejected: adds a second cache-invalidation mechanism (time-based) alongside the range-based one, for a period that changes anyway — no real savings (the open period is re-fetched on the next invocation regardless) for meaningfully more complexity.
- **Modify `AwsCostExplorerAdapter` directly to cache internally.** Rejected: conflates "how to call the Cost Explorer API" with "when it's safe to skip calling it" — two independent concerns. The decorator keeps `AwsCostExplorerAdapter` a pure, cache-free adapter (easy to reason about, easy to test in isolation) and makes the caching layer itself independently testable (`cost-explorer-cache.adapter.spec.ts`) and optional (nothing stops a future caller from composing `AwsCostExplorerAdapter` directly, uncached).

## Consequences

Every `cost`/`trend` invocation for a date range that's already fully settled costs $0 in Cost Explorer fees after the first run — the common case (someone iterating on `--format`/`--pdf` for the same underlying numbers) is now free. The cache lives under the user's home directory, not the project, and is namespaced per AWS account ID so multiple accounts scanned from the same machine never collide or leak data across each other.
