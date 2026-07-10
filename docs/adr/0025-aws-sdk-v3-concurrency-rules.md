# ADR-0025: AWS SDK v3 modular clients with explicit concurrency rules

- **Status:** Accepted; the scheduling rule (parallel across scanners, sequential across regions) is superseded by [ADR-0052](0052-global-scan-worker-pool.md) — the modular-clients choice and the capped internal fan-out still stand

## Context

18 scanners run across multiple regions; uncontrolled concurrency risks throttling regional AWS APIs.

## Decision

Modular AWS SDK v3 clients (`@aws-sdk/client-ec2`, `client-rds`, etc.), one client instantiated per region and destroyed in `finally`. Concurrency rule, applied consistently: different scanners (different APIs) run in parallel; the same scanner across regions runs sequentially; internal fan-out within a scanner (e.g. one CloudWatch call per NAT Gateway) uses `mapWithConcurrency` capped at 5.

## Alternatives Considered

- **AWS SDK v2.** Rejected: v3's modular packages, better typing, and native ESM support fit the bundling strategy ([ADR-0024](0024-esnext-bundler-resolution.md)) better than v2's monolithic client.
- **Run everything (all scanners × all regions) fully in parallel.** Rejected: real risk of throttling regional APIs at scale on accounts with many resources; sequential-per-region for the same scanner was the resolved trade-off.

## Consequences

Predictable, explainable concurrency behavior. Throttling risk is bounded by design rather than discovered by trial and error in production.
