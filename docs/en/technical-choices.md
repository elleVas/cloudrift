# Technical Choices

> 🇮🇹 [Versione italiana](../it/scelte-tecniche.md)

This document explains the reasoning behind every technology choice in the project, with the trade-offs considered.

---

## Nx Monorepo

**Choice:** manage all code in a single Nx repository with a pnpm workspace.

**Why:**
- Allows sharing `shared-kernel` across all bounded contexts without publishing to npm
- Nx targets (`build`, `test`, `typecheck`) run only on modified projects (`nx affected`)
- Local caching (and optionally Nx Cloud) avoids re-running expensive operations
- The `moduleNameMapper` entries in the jest configs allow importing TypeScript sources directly, without building dependencies before testing

**Trade-off:** Nx's initial configuration complexity is higher than a single project, but it pays off as soon as there are more than two libraries to orchestrate.

---

## pnpm as package manager

**Choice:** pnpm instead of npm or yarn.

**Why:**
- Uses hard links instead of copying packages: faster installs, less disk space
- `pnpm-workspace.yaml` explicitly defines which folders are workspace packages
- Internal library dependencies use `"cloud-cost-domain": "workspace:*"`, resolved with symlinks

> The repository has **a single lockfile**: `pnpm-lock.yaml`. Lockfiles from other package managers (`package-lock.json`, `yarn.lock`) must not be committed.

---

## TypeScript with `module: ESNext` and `moduleResolution: bundler`

**Choice:** `"module": "ESNext"` and `"moduleResolution": "bundler"` in `tsconfig.base.json`.

**Why:**
- `moduleResolution: bundler` is the recommended mode when final resolution is delegated to a bundler (esbuild): it allows **extension-less relative imports** (`import { Entity } from './entity.base'`)
- Cross-package imports use the package name (`import x from 'shared-kernel'`), resolved during development by the custom `@cloudrift/source` condition in the packages' `exports` field

**Repo convention: no extensions in relative imports.** All code uses `'./entity.base'`, never `'./entity.base.js'`. Consistency is guaranteed by the fact that the CLI is **bundled**.

**Important consequence (bundled CLI):** the libraries' `tsc` output preserves extension-less imports, which **cannot be loaded by Node in pure ESM**. This is why the CLI build uses esbuild with `bundle: true` and `thirdParty: false`: workspace library code is inlined into the executable (esbuild resolves extension-less imports), while npm packages (AWS SDK, pdfkit, chalk, commander) remain external `require()`s. Result: `node apps/cli/dist/main.js` works with no extra steps. If the libraries ever need to be consumed directly as ESM by Node (outside a bundler), extensions will have to be emitted or a dedicated build step added.

**For tests:** the `tsconfig.spec.json` files use `"module": "CommonJS"` and `"moduleResolution": "Node"` because jest runs in CJS. The jest configs are `jest.config.cjs` (not `.ts`: `ts-node` is not installed, so jest could not load them).

---

## AWS SDK v3

**Choice:** modular clients `@aws-sdk/client-ec2`, `client-rds`, `client-elastic-load-balancing-v2`, `client-cloudwatch`, `client-sts`, `client-pricing`.

**Why:**
- Modular: only the needed client is imported
- Per-region clients: every scanner creates a client with `{ ...createAwsClientConfig(), region: region.code }` and destroys it in the `finally`
- `createAwsClientConfig()` (`utils/client-config.ts`) sets `maxAttempts: 3`, turning on the SDK's built-in retry/backoff for throttling (429) and transient 5xx errors, plus a `NodeHttpHandler` with a 5s connection / 30s request timeout so a single hung connection can't stall a scan indefinitely ([ADR-0058](../adr/0058-aws-client-request-timeout.md)). It's a factory, not a shared constant: every call builds its own `NodeHttpHandler`/connection pool, so one scanner's `client.destroy()` can never tear down another's in-flight connections ([ADR-0064](../adr/0064-per-client-requesthandler-not-shared.md))
- Better typing and native ESM support

**Pattern used in the scanners:**
```typescript
const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
try {
  const candidates = await paginate(/* DescribeVolumesCommand … */);
  const findings = candidates
    .map(mapToEntity)
    .filter((r) => this.policy.evaluate(r, now).isWaste);
  return Result.ok(findings);
} catch (err) {
  return Result.fail(new AwsAdapterError('EBS', err as Error));
} finally {
  client.destroy(); // frees HTTP connections
}
```

**Rate limiting — consistent concurrency rules:**
- (scanner, region) pairs → worker pool with one global bound (12 in-flight scans by default, any mix, overridable via `CLOUDRIFT_SCAN_CONCURRENCY` — LocalStack e2e forces 1, see [ADR-0063](../adr/0063-scan-concurrency-env-configurable-default-restored-to-12.md)), queued scanner-major so the first batch spreads across regions — see [ADR-0052](../adr/0052-global-scan-worker-pool.md)
- Internal fan-out within a scanner (e.g. one CloudWatch call per NAT Gateway) → `mapWithConcurrency` with a cap (5)

**Required-field validation:** scanners never read a required AWS response field with a bare non-null assertion (`v.VolumeId!`). Instead, a local intersection type plus a type-narrowing `.filter()` right after the fetch excludes malformed entries and logs how many were dropped (`DEBUG=cloudrift:*`) — see [ADR-0051](../adr/0051-type-narrowing-guards-on-aws-responses.md).

---

## `CloudWatchIdleScanner` — shared template method for CloudWatch-based scanners

**Choice:** 23 of the 44 scanners extend the abstract `CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity>` (`scanners/cloudwatch-idle.scanner.ts`) instead of writing their own `scan()`.

**Why:** these 23 scanners share the same shape — create a client, list candidates, fetch one CloudWatch metric per candidate (some additionally resolve a live per-type price), map to an entity, apply the policy, wrap errors, destroy the client. The base class owns that lifecycle; a concrete scanner implements only `createPrimaryClient`/`destroyPrimaryClient`/`listResources`/`fetchMetric`/`toEntity`, plus an optional `resolvePrices` for the 12 `--live-pricing`-gated ones. See [ADR-0044](../adr/0044-cloudwatch-idle-scanner-template-method.md).

**Not every scanner fits it:** `s3-no-lifecycle` stays standalone — its CloudWatch call has a fixed 1-day period regardless of the lookback window and an extra dimension, which would have bent the template to fit one outlier. The 11 non-CloudWatch scanners (`ebs-volume`, `ebs-snapshot`, `elastic-ip`, `eni-orphaned`, `gp2-upgrade`, `load-balancer`, `log-group`, `rds-instance`, `workspaces-idle`, `ec2-instance`, `s3-no-lifecycle`) keep their own `scan()`.

---

## STS for the account ID

**Choice:** the account ID is resolved automatically with `sts:GetCallerIdentity` (`resolveAwsAccountId()`); `--account-id` remains as an override.

**Why:** the same credentials used for the scan already know the account; asking the user to type it was redundant and prone to typos in reports that then get circulated. If STS is unreachable the tool degrades to `'unknown'` without failing.

---

## Parametric waste policies instead of hardcoded heuristics

**Choice:** waste conditions live in domain policies (`WastePolicy<T>`) with two cross-cutting parameters exposed by the CLI: `--min-age-days` (default 7) and `--ignore-tag` (default `cloudrift:ignore`).

**Why:** a waste detector is worth as much as its false-positive rate. The three classes of false positive eliminated:
- freshly created/detached/stopped resources (grace period)
- intentionally kept resources (exclusion tag)
- snapshots referenced by registered AMIs (not deletable)

**Trade-off:** the EBS grace period uses `createTime` as a proxy for the detach date (AWS does not expose it): an old volume detached yesterday still gets reported. Acceptable: the opposite case (a freshly created volume reported as waste) was far more damaging to trust in the report.

**Per-check thresholds.** Three policies — `EbsIdlePolicy`, `Ec2UnderutilizedPolicy` and `RdsUnderutilizedPolicy` — additionally take a numeric threshold as a constructor parameter (not a cross-cutting CLI flag, since it is meaningless for the other policies): `ebsIdleMaxOps` (total CloudWatch I/O ops below which an attached volume counts as idle, default 0), `ec2CpuPercent` (max CPU% below which a running EC2 instance counts as underutilized, default 5), and `rdsCpuPercent` (same threshold for an `available` RDS instance, default 5). All configurable only via `config.thresholds`, not a dedicated CLI flag — they are tuning knobs for advisory checks, not something every invocation needs to pass.

**Waste vs. optimization.** Not every detector finds deletable waste: `ebs-gp2-upgrade`, `ec2-underutilized` and `rds-underutilized` are savings opportunities that keep the resource (`FindingCategory: 'optimization'`), kept out of the headline waste total and the CI gate (see [architecture.md](./architecture.md#waste-vs-optimization--findingcategory)). `ec2-underutilized` and `rds-underutilized` are further marked `estimated: true`: CPU alone doesn't prove RAM/network (EC2) or storage I/O/connections (RDS) are equally idle.

---

## ts-jest for tests

**Choice:** `ts-jest` as the transformer for `.spec.ts` files.

**Why:**
- Runs `.spec.ts` files without pre-compilation
- `diagnostics: false` in the preset disables type-checking during tests (already guaranteed by the separate `typecheck` target), making them faster
- Simple integration with the workspace's `moduleNameMapper`

**Critical note:** `ts-node` is NOT installed, so the jest configs must remain `.cjs`. Converting them to `.ts` would require adding `ts-node`.

---

## Result<T, E> — Railway-Oriented Programming

**Choice:** an explicit `Result` type instead of exceptions for expected errors — **including user input**.

**Why:**
- JavaScript exceptions are untyped; with `Result` the caller is forced by the type system to handle both cases
- Simple composition: a failure propagates or is collected as a value

**Pattern consistency:** `AwsRegion.parse()` returns `Result<AwsRegion, InvalidAwsRegionError>` and is the path the CLI uses to validate `-r`. A throwing `AwsRegion.create()` also exists **only** for codes known at compile time, typically test fixtures: external input never goes through it.

```typescript
const parsed = AwsRegion.parse(code);
if (!parsed.ok) return fail(parsed.error.message); // clean message, exit 1, no stack trace
```

**Two error hierarchies, not one.** `DomainError` (domain layer) and `InfrastructureError` (infrastructure layer, e.g. `AwsAdapterError`) are siblings, not parent/child: the domain must not have a type that implies AWS knowledge it doesn't have. See [ADR-0049](../adr/0049-infrastructureerror-not-domainerror.md).

---

## Zod for config parsing

**Choice:** `cloudrift.config.json` is validated with a single Zod schema (`CloudriftConfigSchema.safeParse(obj)`) instead of a hand-written `if`/push-error parser.

**Why:** the old parser was 308 lines of repeated per-field checks, correct but with nothing tying its shape to the `CloudriftConfig` TypeScript interface — the two could drift silently. The schema is declared `satisfies z.ZodType<CloudriftConfig, unknown>`: if schema and interface ever diverge, the project fails to compile. See [ADR-0048](../adr/0048-zod-config-parsing.md).

**Result:** `cloudrift.config.ts` went from 308 to 151 lines; all 26 pre-existing config tests (including multi-error aggregation) pass unchanged.

---

## Minimal debug logger

**Choice:** `createLogger(namespace)` (`libs/shared/kernel/src/logging/logger.ts`) — zero dependencies, one `debug(message, meta?)` method, gated by the `DEBUG` env var (`DEBUG=cloudrift:*` wildcard, exact match, or comma-separated patterns), writing to **stderr** so it never mixes with the report on stdout.

**Why:** not Winston, not Pino — those are structured-logging frameworks for long-running services (transports, multiple levels, JSON pipelines), none of which a CLI needs. A namespace-gated debug switch was the entire requirement: how long each scanner took, and why a scanner found nothing. See [ADR-0047](../adr/0047-minimal-namespaced-debug-logger.md).

---

## Commander.js for the CLI

**Choice:** `commander` for argument parsing.

**Why:** declarative API, automatic help, `parseAsync` for async handlers, lightweight.

---

## @clack/prompts for the interactive scanner picker

**Choice:** `@clack/prompts`' `multiselect` for the `analyze` scanner-selection wizard (see [ADR-0041](../adr/0041-interactive-scanner-selection-wizard.md), [how-it-works.md](./how-it-works.md#scanner-selection-the-wizard-and-its-escape-hatches)).

**Why:** lighter than `inquirer` and has a native checkbox multiselect out of the box. It's ESM-only, so it's loaded with a dynamic `import()` inside `promptScannerSelection()` rather than a static import — a static import broke `cli:test` (Jest can't parse an ESM package by default) and would also pull the prompt renderer into every process that imports the command module, even non-interactive ones.

**Trigger, not a flag:** the wizard shows by default in a real terminal, not behind an opt-in `--interactive` flag — the ask was for scanner selection to be the normal experience, with explicit escape hatches (`--scanners <kinds...>`, `--all-services`) for scripted use, and a silent default-to-everything whenever `stdout` isn't a TTY, `CI=true`, or `--silent` is set, so automation is never blocked waiting on input.

---

## chalk and cli-table3 for console output

**Choice:** `chalk` for colors and `cli-table3` for tables.

**Why:** automatic color-support handling; aligned, readable tables. `--format json` (not `--json`, which is a file artifact, independent of `--format`) suppresses the table to keep machine-readable stdout clean; `--silent` suppresses it for file-only runs regardless of `--format`.

---

## pdfkit for the PDF report

**Choice:** `pdfkit` for PDF generation with `--pdf`.

**Why:**
- Pure Node.js library: no headless browser (~300 MB of Chromium avoided), no binary dependency
- Low-level API, verbose but predictable
- Stream-based: writes to `fs.createWriteStream` without buffering the whole PDF

**Overflow handling:** `drawTable` implements page breaks — when rows exceed the bottom margin, it closes the segment border, opens a new page and redraws the header. Cell content is **never truncated**: `wrapToLines()` grows a cell to however many lines it needs (a single overlong token, e.g. a log-group ARN with no spaces, is character-split so what's measured always matches what's rendered), and the row height grows to match. `clip()`'s ellipsis behavior still exists but is only used where a caller explicitly opts into a hard line cap — no current formatter does. Column widths are sized from actual header/cell content rather than a fixed per-kind ratio, shrinking the widest column first if the total overflows the page. Shared by all three PDF reports (waste, cost comparison, spend trend) via `pdf-shared.ts`, extracted alongside the `cost`/`trend` PDFs — see [ADR-0072](../adr/0072-pdf-shared-layout-module.md).

---

## AWS Cost Explorer for `cost`/`trend`

**Choice:** `@aws-sdk/client-cost-explorer`'s `GetCostAndUsageCommand`, wrapped by a single `CostExplorerPort` (`getCostAndUsage`) — the same one-method-port minimalism as `PricingPort`.

**Why:** it's the only AWS API this project calls that bills per request ($0.01), so it gets treatment nothing else needs: a global, region-less client (Cost Explorer has one fixed `us-east-1` endpoint), a mandatory confirmation prompt before the first call (bypassable with `-y`/`--yes`/`--silent`/CI, same convention as [ADR-0041](../adr/0041-interactive-scanner-selection-wizard.md)'s wizard), and a disk cache (`CachedCostExplorerAdapter`) that only caches date ranges more than 2 days in the past, per AWS's documented reconciliation lag for recent data. See [ADR-0069](../adr/0069-cost-explorer-integration-billed-api-confirmation.md) / [ADR-0070](../adr/0070-cost-explorer-disk-cache-decorator.md).

---

## jimp for the brand-mark generation pipeline

**Choice:** `jimp`, a devDependency used only by three offline codegen scripts (`scripts/generate-brand-mark-icon.mjs`, `generate-brand-mark-title.mjs`, and indirectly related `generate-pdf-logo-data.mjs`, which is jimp-free) — never imported by CLI runtime code, never shipped in the published bundle.

**Why:** the CLI's brand mark (shown by both the wizard's intro and `analyze`'s banner) is a small pixel-art rendition of the real logo (`docs/assets/cloudrift.png`), sampled once offline into a committed TypeScript data file rather than processed at runtime — no image-processing dependency in the shipped package. `posterize()` before resize was required for legibility: the source PNG's anti-aliased edges have no clean low-resolution grid to recover by resizing alone. See [ADR-0073](../adr/0073-brand-mark-pixel-art-pipeline.md).

---

## No dependency injection framework

**Choice:** manual constructor injection; the composition root is `analyze-waste.composition.ts`, called by `analyze-waste.command.ts` through the injectable `AnalyzeDeps.createAnalysis` seam.

**Why:** the graph is flat — the composition root instantiates pricing, policies and scanners and passes them to the use case; the command just orchestrates options and output around that call. A DI container (InversifyJS, tsyringe) would add configuration and `emitDecoratorMetadata` with no benefit at this scale. The plugin model (`WasteScannerPort[]`) makes the scanner array the only "registry" needed.

---

## Cost estimation

Prices live **only** in `prices.json` (infrastructure), with per-region overrides and fallback to `default` (us-east-1). The file declares `pricesAsOf` (the price table's last verification date) and every report — table, PDF and JSON — exposes it, together with the disclaimer that estimates may differ from the actual bill (discounts, reserved pricing, regional variations).

| Resource | Price (us-east-1) |
|---|---|
| EBS gp3 / gp2 / io1-io2 | $0.080 / $0.100 / $0.125 per GB-month |
| EBS st1 / sc1 / standard | $0.045 / $0.018 / $0.050 per GB-month |
| EBS snapshot | $0.05/GB-month |
| Unassociated Elastic IP | $0.005/h ≈ $3.60/month |
| RDS storage gp2/gp3 | $0.115/GB-month |
| ALB/NLB (base) | ~$16.20/month |
| NAT Gateway (base) | ~$32.40/month |

**Three pricing layers (the `PricingPort` payoff).** Prices resolve per `(region, key)` from, in order: the user's `prices` overrides in the config (negotiated/company rates — highest), the **AWS Pricing API** (`--live-pricing`, `AwsPricingApiAdapter.warmUp` fetches and materialises a table), and the built-in `prices.json` (always present). All three share the same `PriceTable` shape, so they compose with a plain `mergePriceTables`; the getters stay synchronous (the live adapter warms up before the scan). Swapping/adding a source never touches the scanners or the domain — exactly what the port buys.

Two safety properties: the live adapter accepts a price **only if the filters resolve to a single value** (ambiguous → fall back to static, never a wrong guess), and even live prices are AWS **list** prices, not the actual bill (Savings Plans / RI / EDP) — the `prices` override is the only way to encode real rates. `getPricesAsOf()` reflects which layer was used.

**Maintenance:** updating the static fallback = updating `prices.json` **and** its `pricesAsOf` field.

**The one exception: per-instance-type EC2 pricing.** `AwsEc2UnderutilizedScanner` doesn't fit the three-layer model above: the cardinality of EC2 instance types is too high to put in `prices.json` or to pre-fetch in `warmUp()`. Instead it calls `AwsPricingApiAdapter.getEc2InstancePricePerMonth(region, instanceType)` directly, on demand, per distinct instance type observed in the scan. The consequence is by design, not an oversight: without `--live-pricing` there is no price source at all for this check, so the composition root simply does not register the scanner, rather than reporting a savings estimate of zero.
