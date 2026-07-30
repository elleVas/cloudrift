# ADR-0099: Local historical trend store (SQLite, per-account, full snapshot forever)

- **Status:** Accepted (2026-07-30)

## Context

ADR-0067 already noted that each domain's DTO (`WasteReportDto`, `DeadResourcesReportDto`, `ResourceSecurityReportDto`) is "persistable as-is... for scan history, without a schema migration," but nothing was built on that hint — `trend` remained Cost-Explorer-only, with no local accumulation of `analyze`/`dead-resources`/`resource-security` runs over time. This is also the foundation the future Pro analytics candidates (forecast, anomaly detection, RI/SP utilization) are meant to build on: none of that is possible without a local history to compute trends from.

Three scoping questions needed answers before writing any code:

1. Where does the data live, given cloudrift's "your data never leaves your machine" positioning rules out any hosted store?
2. What happens when the write fails?
3. Do we store every run forever, or only aggregates?

## Decision

**Storage:** one SQLite file per AWS account, at `~/.cloudrift/trends/<account-id>.db` — same `~/.cloudrift/<purpose>/...` convention as `CachedCostExplorerAdapter` (ADR-0070), and keyed by account for the same reason: scans are already account-scoped. Cross-account rollup (once the paid multi-account/Organizations feature exists) is explicitly **not** designed here — deferred until that feature is actually built.

**Write path:** best-effort, never fails the calling command. Each of `analyzeWasteCommand`, `deadResourcesCommand`, `resourceSecurityCommand` calls `persistTrendSnapshot()` once, right after producing their normal report output, wrapped internally in try/catch (mirrors `CachedCostExplorerAdapter.writeCache`, ADR-0070). A permission error, full disk, or corrupt DB file only ever produces a debug log line.

**Granularity:** a full snapshot on every run, kept forever — no aggregation-only table, no pruning. The stored `payload` is exactly each domain's own `--format json` output (the DTO is already the one correct JSON-safe serialization of a summary — see `toWasteReportDto` et al. — so the snapshot writer reuses `formatWasteReportAsJson`/`formatDeadResourcesReportAsJson`/`formatResourceSecurityReportAsJson` rather than re-deriving one). Chosen deliberately over the cheaper "aggregates forever + detail for last N runs" option: the DB grows unbounded by design for now; a retention/pruning strategy is left as a follow-up once real usage shows how fast it grows.

**New package:** `libs/shared/trend-store` (`scope:shared`), exporting `persistTrendSnapshot`/`readTrendSnapshots`/`defaultTrendStoreDir`. It knows only `{ domain, generatedAt, payload }` — no domain-specific DTO types — so it has zero dependency on `scope:domain`/`scope:application` packages, same constraint `ScanCoordinatorUseCase` (ADR-0095) is already built around. The persist call sits one level above the scan coordinator, inside each CLI command, since only the command layer knows the resolved `accountId`.

**SQLite binding: Node's built-in `node:sqlite`**, not `better-sqlite3` or `sql.js`. The repo's dev/CI Node version is already pinned to 24 (`.nvmrc`), and a native `node-gyp` addon would have reintroduced exactly the cross-platform prebuilt-binary complexity the Homebrew bottle pipeline and npm/GH Marketplace distribution already have to account for — `node:sqlite` needs none of that. One consequence: `apps/cli`'s published `engines.node` is `>=20`, but `node:sqlite` requires Node ≥22.5. A static `import` of a nonexistent core module throws at load time, which would crash the whole CLI (every command, not just this feature) for anyone still on Node 20/21 — so `libs/shared/trend-store` loads it via a lazy `await import('node:sqlite')`, only when a snapshot is actually written or read, always inside the existing best-effort try/catch. On Node <22.5, the trend store silently never persists anything; every other command is unaffected.

**New read path:** `cloudrift history` command (table/json output, `--domain`/`--limit`/`--account-id` filters), resolving the account the same way every other command does (`resolveAwsAccountId` via STS, `--assume-role-arn` supported).

## Alternatives Considered

- **Aggregate-only table** (totals/counts, no per-finding detail). Rejected by explicit user choice: loses the ability to diff individual resources between two runs.
- **Hybrid** (aggregates forever + full detail only for the last N runs). Recommended as the default option, but rejected in favor of full-snapshot-forever — the user preferred simplicity now over solving retention preemptively.
- **`better-sqlite3`.** Fast, mature, synchronous API — but a native addon needing prebuilt binaries per platform/arch, complicating the Homebrew bottle pipeline and npm packaging already built for this CLI.
- **`sql.js` (wasm).** No native binary concerns, but in-memory-first: every write means loading/serializing the whole DB buffer, awkward for a store that's meant to grow indefinitely.
- **Single global DB file with an `account_id` column**, instead of one file per account. Rejected: one file per account is simpler to reason about (no risk of one account's write contending with another's) and the per-file scheme still allows an account's file to be deleted/moved independently.

## Consequences

New `shared-trend-store` package, wired into all three scan commands plus the new `history` command. Nothing in the existing report formats or DTOs changed — the trend store is purely additive.

Two things explicitly deferred, not forgotten:
- Retention/pruning strategy for the full-snapshot-forever store, once real DB-size data exists.
- Cross-account aggregation, to be designed together with the future paid multi-account/AWS-Organizations rollup feature (not this ADR's scope).
