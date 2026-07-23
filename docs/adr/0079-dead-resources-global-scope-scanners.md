# ADR-0079: Global-scope scanners in the `dead-resources` coordinator

- **Status:** Accepted (2026-07-23)

## Context

[ADR-0078](0078-dead-resources-parallel-domain.md) shipped the `dead-resources` domain's skeleton with one kind, `ec2-keypair-unused` — deliberately regional and dependency-free, to prove the pattern first. This round added the three kinds that ADR-0078 explicitly deferred: `ec2-ri-expiring-soon`, `iam-user-inactive`, `iam-policy-unattached`.

While implementing the two IAM-based kinds, a real gap surfaced: **IAM is a global AWS service**, unlike every kind `dead-resources`/`cloud-cost` had covered so far. `FindDeadResourcesUseCase`'s coordinator (mirroring `AnalyzeCloudWasteUseCase`) builds one job per (scanner, region) pair. For a global service, that would call `ListUsers`/`ListPolicies` once per requested region and return the *same* users/policies every time — duplicate findings, and wasted AWS API calls, scaling with `--regions`. `ec2-ri-expiring-soon` has no such problem: Reserved Instances are genuinely region/AZ-scoped, same as every existing regional kind.

## Decision

`DeadResourceScannerPort` gains an optional `scope?: 'regional' | 'global'` field (default `'regional'`, so every existing/future regional scanner needs no change). `FindDeadResourcesUseCase`'s job-builder branches on it:

```ts
const jobs = this.scanners.flatMap((scanner) =>
  scanner.scope === 'global' ? [{ scanner, region: request.regions[0] }] : request.regions.map((region) => ({ scanner, region })),
);
```

A `'global'` scanner is called **exactly once**, regardless of how many regions were requested. The `region` argument it receives is an arbitrary one of the requested regions (`regions[0]`) and the implementation must ignore it — `AwsIamUserInactiveScanner`/`AwsIamPolicyUnattachedScanner` both take `_region: AwsRegion` (unused, ESLint-ignored via that library's own `argsIgnorePattern: '^_'` override) and construct their `IAMClient` against a hardcoded `IAM_ENDPOINT_REGION = 'us-east-1'` instead — IAM's actual signing region, deterministic regardless of what the coordinator happened to pass in. `scanErrors`/debug logs report `'global'` as the region label for these scanners rather than a real (and misleading) region code.

**Consequence for the domain model:** `DeadResource.region` changed from required to optional (`region?: AwsRegion`) — a global-scope finding has no real region to report, and a fake placeholder (e.g. always `'us-east-1'`) would misrepresent real data. `IamUserInactive`/`IamPolicyUnattached` simply don't implement a `region` getter; `Ec2KeyPairUnused`/`Ec2RiExpiringSoon` still declare theirs as non-optional `AwsRegion` (TypeScript allows a concrete class to narrow an interface's optional property to required), so existing regional presenters/tests needed no changes. The two IAM presenters (`iam-user-inactive`, `iam-policy-unattached`) simply omit the "Region" column instead of showing an empty/placeholder one.

**New kinds' policy design notes** (both extend `DeadResourcePolicy`, reusing `ignoreTag`/`excludeTagValues`):

- `Ec2RiExpiringSoonPolicy` does **not** use the base class's grace-period machinery (`minAgeDays`) — that answers "how long since created," the opposite of "how soon does this end." It takes its own `expiringWithinDays` threshold (default 30), same pattern as e.g. `EbsIdlePolicy`'s extra `maxOps` param.
- `IamUserInactivePolicy` reuses the grace period as intended (a brand-new user hasn't had time to log in) and adds its own `inactivityDays` threshold (default 90 — CIS AWS Foundations Benchmark's own figure for stale credentials). "Last activity" is `max(PasswordLastUsed, every access key's LastUsedDate)`, computed by the scanner via a bounded-concurrency (5) fan-out of `ListAccessKeys`+`GetAccessKeyLastUsed` per user.
- `IamPolicyUnattachedPolicy` is the simplest: grace period only, flags any customer-managed policy (`ListPoliciesCommand({ Scope: 'Local' })` — server-side filter excluding AWS-managed policies the account can't delete anyway, per ADR-0019) with `AttachmentCount === 0`.

**Deliberate duplication, continued:** `mapWithConcurrency` (used by the IAM user scanner's per-user fan-out) is copied into `dead-resources-infrastructure-aws-adapter` verbatim, same reasoning as `paginate`/`createAwsClientConfig`/`AwsAdapterError` in ADR-0078.

## Alternatives Considered

- **Dedup findings downstream by `(kind, id)`.** Rejected: still calls `ListUsers`/`ListPolicies` once per region (wasted AWS API calls, worse under `--regions us-east-1 eu-west-1 ...` with more regions), just hides the duplication instead of not doing the redundant work.
- **Separate CLI command for account-wide checks (no `--regions`), mirroring `cost`/`trend`.** Rejected: splits `dead-resources` into two command families for what is, from the coordinator's perspective, a small job-scheduling difference — and breaks the single flat wizard multi-select already built across all kinds (ADR-0078), which would need its own split too.

## Consequences

All 4 kinds now registered in `dead-resources.composition.ts`'s `buildScanners()` (still a plain array — 4 entries doesn't warrant the kind of split ADR-0077 did at 43). New IAM permissions required only for `dead-resources`, documented as their own block in `docs/en/iam-permissions.md`/`docs/it/permessi-iam.md` (`ec2:DescribeKeyPairs` — missed in ADR-0078, added now too — `ec2:DescribeReservedInstances`, `iam:ListUsers`, `iam:ListAccessKeys`, `iam:GetAccessKeyLastUsed`, `iam:ListPolicies`).

Verified via `pnpm nx run-many --target={lint,test,build} --all`: all 8 projects green. New tests: 25 in `dead-resources-domain` (entities + policies for all 3 new kinds), 19 in `dead-resources-infrastructure-aws-adapter` (3 new scanners), 3 in `dead-resources-application` (global-scope job-grid behavior: called once regardless of region count, coexists correctly with a regional scanner in the same run, `scanErrors` labeled `'global'` not a real region), 3 in `apps/cli` (presenter dispatch for the 3 new kinds). Zero regressions in the existing 438+240+43+116 cost-waste-side and prior dead-resources tests.

## `--scanners` and `--pdf`, completed same day

ADR-0078 deferred both — "not worth it for a single kind." With 4 kinds now registered, both were added before this branch was considered done, closing the gap rather than leaving it as a known loose end:

- **`--scanners <kinds...>`**: validated against `DEAD_RESOURCE_KINDS` (`resolveExplicitScannerKinds` in `dead-resources.command.ts`, same shape as `analyze`'s `resolveExplicitScanners`), populating the same `scannerKinds` field the wizard already used — `--scanners` wins if both are somehow set.
- **`--pdf [filename]`**: `dead-resources-report.pdf-formatter.ts`, built on the same shared `pdf-shared.ts` module the other three PDF reports use ([ADR-0072](0072-pdf-shared-layout-module.md)) — masthead, metric boxes (total/critical/warning/info instead of $/mo), a breakdown-by-check table, a severity-ranked "top findings" list (mirrors `waste-report`'s cost-ranked quick-wins), and one detail page per kind with a severity column instead of a cost column. Disclaimer text is its own constant, `DEAD_RESOURCES_REPORT_DISCLAIMER` (`dead-resources-application`) — deliberately separate from `REPORT_DISCLAIMER`/`COST_REPORT_DISCLAIMER`, same reasoning as the existing two: no cost estimates to caveat here, the domain talks about hygiene findings instead. The wizard gained a matching `promptDeadResourcesOutput()` (table/json + a PDF confirm), mirroring `promptWasteOutput()` without the markdown/JSON-file options `dead-resources` doesn't have.

11 new tests (6 command-level — flag validation, precedence over the wizard's `scannerKinds`, PDF file written to disk with/without `--silent` — plus 3 formatter-level PDF smoke tests covering a multi-kind summary, an empty summary, and one with scan warnings). No new AWS permissions — both features operate on data the existing scanners already fetch.
