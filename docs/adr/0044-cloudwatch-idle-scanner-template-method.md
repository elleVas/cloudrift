# ADR-0044: `CloudWatchIdleScanner` template method for the CloudWatch-based scanners

- **Status:** Accepted (2026-07-09)

## Context

18 of 29 scanners follow the same shape: create an SDK client, list candidate resources, fetch one CloudWatch metric per resource (some additionally resolve a live per-type price from the Pricing API), map to an entity, apply the waste policy, wrap errors in `AwsAdapterError`, destroy the client in `finally`. Each scanner reimplemented all of it — client lifecycle, the concurrent metric fan-out, the `Result` wrapping — independently; the actual `GetMetricStatisticsCommand` call (`Namespace`/`MetricName`/`Dimensions`/`Period`/`Statistics`) was the smallest part of the duplication, not the largest.

A first pass extracted only the CloudWatch call into free functions (`metricWindow`, `sumMetric`, `sumMetrics`, `avgMetric`, `avgMaxMetric` in `utils/cloudwatch-metrics.ts`). That removed the literal `GetMetricStatisticsCommand` repetition but left the try/catch/finally, client creation/destruction and `Result` wrapping duplicated in all 18 files — the bigger share of the boilerplate untouched.

## Decision

An abstract generic base class, `CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity>`, owns the whole `scan()` lifecycle:

```typescript
abstract class CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity extends WastedResource>
  implements WasteScannerPort
{
  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const primary = this.createPrimaryClient(region);
    const cw = new CloudWatchClient({ ...AWS_CLIENT_DEFAULTS, region: region.code });
    try {
      const raw = await this.listResources(primary, region);
      if (raw.length === 0) return Result.ok([]);
      const window = metricWindow(this.windowHours);
      const [metrics, prices] = await Promise.all([
        mapWithConcurrency(raw, this.metricConcurrency, (r) => this.fetchMetric(cw, region, r, window)),
        this.resolvePrices(raw, region),
      ]);
      const now = new Date();
      const entities = raw
        .map((r, i) => this.toEntity(r, metrics[i], prices, region, now))
        .filter((e) => this.policy.evaluate(e, now).isWaste);
      return Result.ok(entities);
    } catch (err) {
      return Result.fail(new AwsAdapterError(this.serviceLabel, err as Error));
    } finally {
      this.destroyPrimaryClient(primary);
      cw.destroy();
    }
  }
  // abstract: createPrimaryClient, destroyPrimaryClient, listResources, fetchMetric, toEntity
  // overridable, defaults to a no-op: resolvePrices
}
```

Each concrete scanner keeps its existing public constructor (so the composition root and specs are unchanged) and implements 4 required hooks plus, for the 9 scanners gated behind `--live-pricing`, an optional `resolvePrices` override for the async Pricing-API fan-out — run in `Promise.all` alongside the metric fetch rather than after it (see Consequences).

`utils/cloudwatch-metrics.ts` is kept, scoped down to pure, stateless, no-decision leaf calls (the raw `GetMetricStatisticsCommand` wrapper); the base class and every scanner's hooks call into it. `s3-no-lifecycle` deliberately does **not** extend the base class: its CloudWatch call has a fixed 1-day period regardless of the lookback window, an extra `StorageType` dimension, and no `windowHours` constructor parameter at all — forcing it into the template would have meant bending the template to fit one outlier, the exact "framework for its own sake" this design avoids.

## Alternatives Considered

- **Keep the free-function-only extraction.** Rejected: leaves the larger share of duplication (client lifecycle, try/catch/finally, `Result` wrapping — the concern this ADR is about) untouched; only the smallest, already-parametric piece (the CloudWatch call itself) was addressed.
- **A stateful injected collaborator class** (e.g. `new CloudWatchMetrics(cw).sum(...)`) instead of inheritance. Considered and explicitly rejected after discussion: duplication removed by delegating to a collaborator is architecturally close to the free-function version it was meant to replace — same lifecycle code still duplicated 18 times, just calling a different API. Inheritance (a template method) is what actually removes the duplication, because the lifecycle itself is what's shared, not just the leaf call.
- **Force `s3-no-lifecycle` into the base class** by adding a 5th generic parameter or an overridable window strategy. Rejected: the base class already grew to 4 generic type parameters and an optional hook for the 9 live-pricing scanners; accommodating one more axis of variation for a single outlier would have made the template harder to read for the 18 scanners it actually fits cleanly.

## Consequences

1227 lines removed across the 18 migrated scanners (try/catch/finally, client lifecycle, and the duplicated `sumMetric`/`cpuStats`/etc. private methods), replaced by 93 lines (base class) + 107 lines (`cloudwatch-metrics.ts`) of shared code. Every migrated scanner's public constructor is unchanged, so `analyze-waste.composition.ts` (ADR-0043) and all 18 scanner specs needed zero modifications — the specs mock the SDK and assert `GetMetricStatisticsCommand` arguments, which are identical before and after.

One unplanned, verified side effect: the 9 `--live-pricing` scanners previously fetched CloudWatch metrics and *then* awaited the Pricing API fan-out, sequentially. The base class runs both via `Promise.all`, so they now run concurrently — a real speed improvement (two independent AWS API calls, no shared state), in the same direction as the still-open concurrency-model finding, but not itself a fix for it: peak in-flight requests per scanner roughly doubles (from ≤5 to ≤10, since `metricConcurrency` and the live-pricing fan-out's own concurrency cap are each ~5), and it was verified via `nx run cli:e2e-localstack` (identical findings with and without the change) before being kept rather than reverted.
