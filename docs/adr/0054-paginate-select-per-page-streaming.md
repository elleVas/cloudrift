# ADR-0054: `paginate()` filters per page instead of materializing every raw item

- **Status:** Accepted (2026-07-10)

## Context

`paginate()` (`libs/cloud-cost/infrastructure/aws-adapter/src/utils/paginate.ts`) accumulated every page's items into a single array before the caller filtered/mapped it into findings. On an account with tens of thousands of EBS snapshots or CloudWatch log groups — real numbers seen on enterprise accounts — this holds the entire raw response set in memory before producing what is usually a small fraction of actual waste findings. No limit, no backpressure: the failure mode is an OOM on the first large account that runs the tool.

## Decision

`paginate<TItem, TResult>()` takes an optional second parameter, `select: (items: TItem[]) => TResult[]`, applied **per page** before accumulating, instead of after the full list is materialized:

```typescript
export async function paginate<TItem, TResult = TItem>(
  fetchPage: (cursor?: string) => Promise<{ items: TItem[]; cursor?: string }>,
  select: (items: TItem[]) => TResult[] = (items) => items as unknown as TResult[],
): Promise<TResult[]>
```

Default `select` is the identity function, so the 24 existing call sites that don't pass one keep bit-for-bit identical behavior. Applied to the two scanners whose resource count genuinely grows unbounded over time (snapshots and logs accumulate for years, unlike NAT gateways or EIPs which stay in the tens/hundreds even on large accounts):

- `aws-log-group.scanner.ts` — single list, filter+map applied directly per page.
- `aws-ebs-snapshot.scanner.ts` — the delicate case: a snapshot is "orphaned" only if **no** volume or AMI references it, so proving absence needs the full volumes+images lists materialized before judging any snapshot page. Volumes and images stay fully materialized (they're the small lists); only snapshots — the genuinely unbounded side — are judged and filtered page-by-page via `select`. Volumes+images are now fetched in parallel with each other but **before** snapshots (previously all three were fetched together) — a small latency cost traded for correlation correctness.

## Alternatives Considered

- **`maxPages?: number` hard cutoff.** Initially proposed, rejected after the user pushed back: a hard cutoff means a report that silently omits results past the limit — for a tool whose whole purpose is "find me all the waste," an incomplete report with no warning is worse than the OOM it's meant to prevent, especially for exactly the enterprise accounts the fix targets.
- **Applying `select` to all 26 `paginate()` call sites uniformly.** Rejected: the other 24 call sites (NAT gateways, EIPs, ENIs, etc.) stay on lists in the tens/hundreds even on large accounts — applying the same pattern there is cost without a real benefit today. The mechanism is ready and reusable if another scanner turns out to be at risk later.

## Consequences

2 new tests in `paginate.spec.ts` (per-page `select` application; a non-regression guard proving no raw-item accumulation when `select` filters). 291/291 aws-adapter tests pass unchanged, including `scanner-contract.spec.ts` against real fixtures. See `docs/code-review-2026-07-10.md` §5 for the full investigation writeup.
