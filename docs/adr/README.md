# Architecture Decision Records

This log captures decisions made over the course of building cloudrift — both purely technical/architectural ones and process/scope decisions that shape how the project evolves. Unlike the rest of `docs/`, ADRs are **English-only**: they are an internal engineering log, not user-facing documentation.

**Convention:** ADRs are append-only. When a decision changes, add a new ADR that supersedes the old one (update the old one's Status to `Superseded by ADR-XXXX`) — never edit history in place.

Each entry follows: Context → Decision → Alternatives Considered → Consequences.

## Process & scope

| ADR | Title | Status |
|---|---|---|
| [0001](0001-scanner-coverage-criteria.md) | Scanner coverage criteria: fixed cost at rest only | Accepted |
| [0002](0002-localstack-e2e-scope.md) | LocalStack e2e scope limited to 13/18 scanners | Accepted |
| [0003](0003-redshift-deferred.md) | Redshift deferred out of v0.4.0 | Superseded by [ADR-0038](0038-eleven-fixed-cost-scanners-phase-5-5.md) |
| [0004](0004-orphaned-eni-included.md) | Orphaned ENI scanner included despite ~$0 savings | Accepted |
| [0005](0005-disclaimer-contact-in-application-layer.md) | Disclaimer/contact centralized in the application layer | Accepted |
| [0006](0006-dto-disclaimer-contact-top-level.md) | Disclaimer/contact as top-level DTO fields, not under `meta` | Accepted |
| [0007](0007-no-release-until-requested.md) | No version bump/tag/publish until explicitly requested | Accepted |
| [0008](0008-commit-and-pr-owned-by-user.md) | Commit and PR always owned by the user | Accepted |
| [0038](0038-eleven-fixed-cost-scanners-phase-5-5.md) | 11 new fixed-cost scanners in v0.5.0 Phase 5.5 | Accepted |
| [0065](0065-vertical-premium-scanners-phase-6-strategy.md) | Vertical premium scanners — Phase 6 strategy | Accepted |
| [0078](0078-dead-resources-parallel-domain.md) | `dead-resources` as a new parallel domain, not a `WastedResource` extension | Accepted, kind list extended by [ADR-0079](0079-dead-resources-global-scope-scanners.md) |
| [0079](0079-dead-resources-global-scope-scanners.md) | Global-scope scanners (IAM) in the `dead-resources` coordinator | Accepted |

## Cost analytics (`cost` / `trend`)

| ADR | Title | Status |
|---|---|---|
| [0069](0069-cost-explorer-integration-billed-api-confirmation.md) | AWS Cost Explorer integration for `cost`/`trend`, gated by an explicit billing confirmation | Accepted |
| [0070](0070-cost-explorer-disk-cache-decorator.md) | Cost Explorer responses cached on disk via a decorator, only once a period is safely closed | Accepted |

## Pricing

| ADR | Title | Status |
|---|---|---|
| [0009](0009-three-pricing-layers.md) | Three pricing layers, in priority order | Accepted |
| [0010](0010-live-price-unambiguous-match-only.md) | Live price accepted only on unambiguous filter match | Accepted |
| [0011](0011-live-pricing-gated-scanners.md) | EC2/RDS/ElastiCache underutilized scanners gated behind `--live-pricing` | Accepted |
| [0012](0012-ec2-price-on-demand.md) | EC2 per-instance-type price fetched on demand | Accepted |
| [0037](0037-pricing-extension-query-api-not-bulk.md) | New scanners' pricing extends the Query API, not the Bulk API | Accepted |
| [0045](0045-pricingport-single-getprice-method.md) | `PricingPort` collapsed to a single generic `getPrice(region, key)` | Accepted |
| [0057](0057-unknown-config-price-keys-warning.md) | Unknown price keys in config produce a non-blocking warning | Accepted |

## Architecture

| ADR | Title | Status |
|---|---|---|
| [0013](0013-ddd-hexagonal-plugin-model.md) | DDD + Hexagonal architecture with a plugin model | Accepted |
| [0014](0014-wastedresource-inbound-boundary.md) | `WastedResource` as the sole inbound-boundary type | Accepted |
| [0015](0015-findingcategory-waste-vs-optimization.md) | `FindingCategory` split: waste vs. optimization | Accepted |
| [0016](0016-waste-rules-in-domain.md) | Waste rules live in the domain, not in AWS API filters | Accepted |
| [0017](0017-policy-cross-cutting-rules.md) | Two cross-cutting rules in every `WastePolicy` | Accepted |
| [0018](0018-scan-errors-per-scanner-region.md) | Scan errors collected per (scanner, region) pair | Accepted |
| [0019](0019-server-side-filter-optimization-only.md) | Server-side filtering is an optimization only, never the decision | Accepted |
| [0020](0020-multicloud-path-deferred.md) | Multi-cloud: path kept open, not built now | Accepted |
| [0021](0021-wastereportdto-frontend-contract.md) | `WasteReportDto` as the future frontend's API contract | Accepted |
| [0042](0042-policy-as-code-external-opa-layer.md) | Policy-as-Code via an external OPA layer, not an embedded Rego engine | Accepted |
| [0046](0046-valueobject-deepequal.md) | `ValueObject.equals()` uses a recursive `deepEqual`, not `JSON.stringify` comparison | Accepted |
| [0049](0049-infrastructureerror-not-domainerror.md) | `AwsAdapterError` extends `InfrastructureError`, not `DomainError` | Accepted |
| [0051](0051-type-narrowing-guards-on-aws-responses.md) | Type-narrowing filters replace non-null assertions on AWS SDK responses | Accepted |
| [0052](0052-global-scan-worker-pool.md) | Global worker pool over (scanner, region) pairs in the use case | Accepted, default concurrency superseded by [ADR-0063](0063-scan-concurrency-env-configurable-default-restored-to-12.md) |
| [0053](0053-contract-tests-fixture-replay.md) | Contract tests replay real response fixtures through every scanner | Accepted |
| [0054](0054-paginate-select-per-page-streaming.md) | `paginate()` filters per page instead of materializing every raw item | Accepted |
| [0056](0056-analyze-waste-command-split.md) | `analyze-waste.command.ts` split into option-resolution and post-analysis modules | Accepted |
| [0060](0060-entity-deep-freeze.md) | `Entity` deep-freezes props recursively | Accepted |
| [0062](0062-scan-concurrency-lowered-for-localstack-reliability.md) | Scan concurrency lowered from 12 to 3; CI e2e job retries | Superseded by [ADR-0063](0063-scan-concurrency-env-configurable-default-restored-to-12.md) |
| [0063](0063-scan-concurrency-env-configurable-default-restored-to-12.md) | Scan concurrency default restored to 12, overridable via `CLOUDRIFT_SCAN_CONCURRENCY`; LocalStack e2e forces 1 | Accepted |
| [0074](0074-waste-policies-one-file-per-policy.md) | Waste policies split into one file per policy | Accepted |
| [0075](0075-nx-dep-constraints-layer-enforcement.md) | Nx `depConstraints` enforce the hexagonal layering at lint time | Accepted |
| [0077](0077-scanner-registry-split-on-pricing-seam.md) | Scanner registry split on the always-on/live-pricing seam | Accepted |

## Stack

| ADR | Title | Status |
|---|---|---|
| [0022](0022-nx-monorepo-pnpm-workspace.md) | Nx monorepo + pnpm workspace | Accepted |
| [0023](0023-pnpm-sole-package-manager.md) | pnpm as the sole package manager | Accepted |
| [0024](0024-esnext-bundler-resolution.md) | `module: ESNext` + `moduleResolution: bundler`, no extensions in relative imports | Accepted |
| [0025](0025-aws-sdk-v3-concurrency-rules.md) | AWS SDK v3 modular clients with explicit concurrency rules | Accepted, scheduling rule superseded by [ADR-0052](0052-global-scan-worker-pool.md) |
| [0026](0026-account-id-via-sts.md) | Account ID resolved via STS, not asked from the user | Accepted |
| [0027](0027-parametric-waste-policies.md) | Parametric waste policies instead of hardcoded heuristics | Accepted |
| [0028](0028-ts-jest-for-tests.md) | ts-jest for tests | Accepted |
| [0029](0029-result-type-no-exceptions.md) | `Result<T, E>` instead of exceptions, including for user input | Accepted |
| [0030](0030-commander-for-cli.md) | Commander.js for CLI parsing | Accepted |
| [0031](0031-chalk-cli-table3-console-output.md) | chalk + cli-table3 for console output | Accepted |
| [0032](0032-pdfkit-for-pdf.md) | pdfkit for PDF report generation | Accepted |
| [0033](0033-no-di-framework.md) | No dependency injection framework | Accepted |
| [0041](0041-interactive-scanner-selection-wizard.md) | Interactive scanner-selection wizard (`@clack/prompts`), triggered by default | Accepted |
| [0043](0043-declarative-scanner-registry.md) | Declarative scanner registry replaces the composition-root wall of `new Scanner(...)` | Accepted |
| [0044](0044-cloudwatch-idle-scanner-template-method.md) | `CloudWatchIdleScanner` template method for the CloudWatch-based scanners | Accepted |
| [0047](0047-minimal-namespaced-debug-logger.md) | Minimal namespaced debug logger, gated by `DEBUG`, no dependency | Accepted |
| [0048](0048-zod-config-parsing.md) | Zod replaces the hand-written config parser | Accepted |
| [0050](0050-aws-client-retry-backoff.md) | AWS SDK clients get `maxAttempts: 3` by default, everywhere | Accepted, `requestHandler` sharing refined by [ADR-0064](0064-per-client-requesthandler-not-shared.md) |
| [0058](0058-aws-client-request-timeout.md) | AWS SDK clients get a per-request HTTP timeout, not a global scan timeout | Accepted, `requestHandler` sharing refined by [ADR-0064](0064-per-client-requesthandler-not-shared.md) |
| [0061](0061-pdfkit-lazy-import-and-dynamic-external-detection.md) | `pdfkit` loaded via lazy dynamic import; publish-manifest generator scans for dynamic imports too | Accepted |
| [0064](0064-per-client-requesthandler-not-shared.md) | Every AWS SDK client gets its own `NodeHttpHandler`, not a shared singleton | Accepted |
| [0066](0066-eks-scanners-aws-api-only-kubeconfig-deferred.md) | EKS scanners — AWS API only, kubeconfig deferred | Accepted |
| [0071](0071-unified-entry-wizard-bare-invocation.md) | Bare `cloudrift` (no subcommand, real terminal) launches a unified mode-picker wizard | Accepted |
| [0073](0073-brand-mark-pixel-art-pipeline.md) | Brand mark generated from the real logo via an offline pixel-art sampling pipeline | Accepted |

## Reporting

| ADR | Title | Status |
|---|---|---|
| [0034](0034-pdfkit-link-linebreak-bug.md) | PDF links via pdfkit's `link` option, never combined with `lineBreak: false` | Accepted |
| [0035](0035-output-always-english.md) | Report output is always in English | Accepted |
| [0059](0059-presenter-dispatch-exhaustive-switch.md) | Presenter dispatch via an exhaustive switch on the finding, not a generic `presenterFor(kind)` | Accepted |
| [0072](0072-pdf-shared-layout-module.md) | Shared PDF layout module across all three reports; table cells never truncated | Accepted |
| [0076](0076-resource-name-column-alongside-opaque-ids.md) | A `Name`/`User` column alongside opaque AWS-generated IDs, never replacing them | Accepted |

## Testing

| ADR | Title | Status |
|---|---|---|
| [0036](0036-ec2-underutilized-excluded-from-localstack-e2e.md) | `ec2-underutilized` excluded from the LocalStack e2e harness | Accepted |
| [0039](0039-cloudwatch-localstack-incompatibility.md) | `GetMetricStatistics` fails on LocalStack 4.0 — CloudWatch scanners marked soft | Superseded by [ADR-0040](0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) |
| [0040](0040-localstack-bumped-4-14-0-cloudwatch-fixed.md) | LocalStack bumped to 4.14.0 — CloudWatch incompatibility resolved | Accepted |
| [0055](0055-pdf-formatter-smoke-test.md) | PDF formatter gets a full-coverage smoke test, not a layout snapshot | Accepted |
| [0068](0068-sagemaker-scanners-excluded-from-localstack-e2e.md) | SageMaker scanners excluded from the LocalStack e2e harness | Accepted |

## Future / non-implemented

| ADR | Title | Status |
|---|---|---|
| [0067](0067-saas-readiness-architectural-hints.md) | SaaS readiness — architectural hints for recurring scans (no implementation) | Accepted |
