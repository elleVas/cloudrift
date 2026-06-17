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

**Choice:** modular clients `@aws-sdk/client-ec2`, `client-rds`, `client-elastic-load-balancing-v2`, `client-cloudwatch`, `client-sts`.

**Why:**
- Modular: only the needed client is imported
- Per-region clients: every scanner creates a client with `{ region: region.code }` and destroys it in the `finally`
- Better typing and native ESM support

**Pattern used in the scanners:**
```typescript
const client = new EC2Client({ region: region.code });
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
- Different scanners (different APIs) → in parallel
- Same scanner across regions → sequentially
- Internal fan-out within a scanner (e.g. one CloudWatch call per NAT Gateway) → `mapWithConcurrency` with a cap (5)

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

---

## Commander.js for the CLI

**Choice:** `commander` for argument parsing.

**Why:** declarative API, automatic help, `parseAsync` for async handlers, lightweight.

---

## chalk and cli-table3 for console output

**Choice:** `chalk` for colors and `cli-table3` for tables.

**Why:** automatic color-support handling; aligned, readable tables. With `--json` and no filename, the table output is suppressed to keep the machine-readable stdout clean.

---

## pdfkit for the PDF report

**Choice:** `pdfkit` for PDF generation with `--pdf`.

**Why:**
- Pure Node.js library: no headless browser (~300 MB of Chromium avoided), no binary dependency
- Low-level API, verbose but predictable
- Stream-based: writes to `fs.createWriteStream` without buffering the whole PDF

**Overflow handling:** `drawTable` implements page breaks — when rows exceed the bottom margin, it closes the segment border, opens a new page and redraws the header. Overly long cells are truncated with an ellipsis (`clip()` via `widthOfString`).

---

## No dependency injection framework

**Choice:** manual constructor injection; the composition root is `analyze-waste.command.ts`.

**Why:** the graph is flat — the CLI instantiates pricing, policies and scanners and passes them to the use case. A DI container (InversifyJS, tsyringe) would add configuration and `emitDecoratorMetadata` with no benefit at this scale. The plugin model (`WasteScannerPort[]`) makes the scanner array the only "registry" needed.

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
