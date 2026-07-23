# ADR-0078: `dead-resources` as a new parallel domain, not a `WastedResource` extension

- **Status:** Accepted (2026-07-23)

## Context

cloudrift's scope has so far been deliberately narrow: fixed cost at rest only ([ADR-0001](0001-scanner-coverage-criteria.md)). That criterion explicitly excludes resources with no direct AWS cost — unused EC2 key pairs, unused/orphaned IAM users and policies, expiring Reserved Instances — even when they are clearly "dead" and worth flagging for hygiene reasons. `WastedResource.costEstimate: CostEstimate` is a non-optional field on the domain's sole inbound-boundary type ([ADR-0014](0014-wastedresource-inbound-boundary.md)), so every finding must carry a dollar figure. A handful of existing kinds (`eni-orphaned`, `sqs-dlq-abandoned`, `environment-ghost`) already work around this by hardcoding `CostEstimate.of(0, '...')`, but every formatter still prints a `$0.00/mo` column for them — workable for a handful of kinds, but the wrong foundation for a domain that is *entirely* $0 by design (it would make every report row and the report footer read as "no waste found" even when there are real findings).

The decision to widen cloudrift's scope from "cost waste" to "anything dead/unused in the account" was made 2026-07-22 (competitive motivation: matching and exceeding aws-doctor's feature set). Two structural options were considered then:

- **A. Extend `WastedResource`** with `monthlyCost: 0` and a new category field. Rejected: dilutes what "waste" means semantically for things that cost nothing, and keeps the `$0.00/mo` noise problem.
- **B. New parallel domain** (chosen): its own entity type, its own port, its own use case, its own CLI command and report — same hexagonal pattern as the existing scanner/adapter architecture, but not sharing `WastedResource`'s cost-centric shape.

This ADR records the concrete design of option B's first slice: one new resource kind (unused EC2 key pairs) built end-to-end through every layer, to prove the pattern before adding more kinds.

## Decision

**Three new Nx libraries**, mirroring `cloud-cost-{domain,application,infrastructure/aws-adapter}`'s exact layout and hexagonal layering ([ADR-0013](0013-ddd-hexagonal-plugin-model.md)):

- `dead-resources-domain` (`libs/dead-resources/domain`, `scope:domain`)
- `dead-resources-application` (`libs/dead-resources/application`, `scope:application`)
- `dead-resources-infrastructure-aws-adapter` (`libs/dead-resources/infrastructure/aws-adapter`, `scope:infrastructure`)

**New domain model**, deliberately not reusing `cloud-cost-domain`'s types:

```ts
export type DeadResourceSeverity = 'info' | 'warning' | 'critical';
export interface DeadResource {
  readonly id: string;
  readonly kind: DeadResourceKind;
  readonly region: AwsRegion;
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  readonly hygieneReason: string;   // instead of wasteReason
  readonly severity: DeadResourceSeverity; // instead of costEstimate
}
```

`DeadResourceScannerPort`, `FindDeadResourcesUseCasePort`/`FindDeadResourcesUseCase`, and `DeadResourcePolicy` (ignoreTag/excludeTagValues/grace-period machinery) all mirror their `cloud-cost-*` counterparts' shape and behavior — same proven pattern, separate types. `DeadResourcesSummary` tallies `countBySeverity` instead of summing dollars.

**CLI**: a new top-level `cloudrift dead-resources` command (`--regions`, `--account-id`, `--min-age-days`, `--ignore-tag`, `--format table|json`, `--silent`), its own composition root (`dead-resources.composition.ts`), and its own presenter/formatter pair (`dead-resource-presenters.ts`, table + json formatters) following the exhaustive-switch dispatch pattern ([ADR-0059](0059-presenter-dispatch-exhaustive-switch.md)). Wired into the wizard as a fourth `WizardMode` (`mode-picker.wizard.ts`), with its own flat, non-categorized multi-select (`dead-resource-selection.wizard.ts`) — same shape as `scanner-selection.wizard.ts`, deliberately not grouped by risk category (e.g. "security" vs. "cleanup"): real boundary calls exist (is an unused key pair security or cleanup?) and the existing codebase has no category-grouping precedent to extend.

**First kind: `ec2-keypair-unused`.** `AwsEc2KeyPairUnusedScanner` lists all key pairs (`DescribeKeyPairsCommand`, unpaginated — AWS returns the whole region in one call) and cross-references `KeyName` against every non-terminated instance (`DescribeInstancesCommand`, paginated), flagging any key pair not referenced. Grace period is based on the key pair's own `CreateTime` (falling back to epoch 0, same convention as `AwsAmiUnusedScanner`'s `CreationDate` handling), not `detectedAt` (which is always "now" and would make the grace period meaningless).

## Alternatives Considered

- **Extend `WastedResource` (option A above).** Rejected for the reasons already covered in the 2026-07-22 scope decision: dilutes "waste," keeps the $0.00/mo noise problem.
- **Fold into `analyze` via a flag** (e.g. `--include-hygiene`). Rejected: conflates two domains with different report semantics (dollars vs. severity) in one output, and isn't independently composable in a CI pipeline the way a separate command is.
- **All 4 originally scoped kinds at once** (key pairs, IAM users, IAM policies, expiring RIs). Rejected for this pass: a full skeleton across 3 new libraries plus CLI/wizard wiring is large enough on its own: proving the pattern with one simple, dependency-free kind first de-risks the other three, which need IAM API calls this first kind doesn't.
- **Sub-module inside `cloud-cost-domain`** instead of new top-level libs. Rejected: would blur `WastedResource`'s "sole inbound boundary" invariant ([ADR-0014](0014-wastedresource-inbound-boundary.md)) and force sharing machinery (the registry/exhaustiveness-check pattern) built for one domain.

## Consequences

**Known, deliberate coupling — not full isolation.** `AwsRegion` is re-exported from `dead-resources-domain`'s index rather than duplicated: it is a generic, stable AWS value object with no cost-domain-specific behavior, and duplicating its region-code list would risk the two lists drifting apart. `dead-resources-domain`'s `package.json` therefore depends on `cloud-cost-domain` for this one type. Nx's `depConstraints` ([ADR-0075](0075-nx-dep-constraints-layer-enforcement.md)) enforce *layer* isolation (`scope:domain` can only depend on `scope:shared`/`scope:domain`) but do not, today, enforce *bounded-context* isolation — there is no tag preventing `dead-resources-domain` from importing arbitrary code from `cloud-cost-domain` beyond this one deliberate case. This is a real gap, not a false claim of full separation.

**Known, deliberate duplication.** `paginate()`, `createAwsClientConfig()` (including the one-`NodeHttpHandler`-per-client fix from [ADR-0064](0064-per-client-requesthandler-not-shared.md)) and `AwsAdapterError` are copied verbatim into `dead-resources-infrastructure-aws-adapter` rather than imported from `cloud-cost-infrastructure-aws-adapter`, to keep the two infrastructure adapters decoupled from each other (unlike the `AwsRegion` case, these are infra-layer utilities, not domain concepts). ~80 lines of duplication. Revisit (move to `shared-kernel`) if a third AWS-touching infrastructure lib ever needs the same utilities — not before, per this codebase's stance against premature abstraction.

**No markdown output or config-file support yet** — deferred, no demonstrated need so far (unlike `--pdf` and `--scanners`, both since added — see [ADR-0079](0079-dead-resources-global-scope-scanners.md)).

**No new god-file risk.** `dead-resources.composition.ts`'s `buildScanners()` is a plain array, same shape as `ALWAYS_ON_SCANNERS`/`LIVE_PRICING_SCANNERS` pre-split ([ADR-0043](0043-declarative-scanner-registry.md)) — with one entry today, splitting it the way [ADR-0077](0077-scanner-registry-split-on-pricing-seam.md) split the cost-waste registry would be premature; revisit once kind count actually grows.

Verified via `pnpm nx run-many --target={lint,test,build} --all`: all 8 projects green, 116 CLI tests (9 new for `dead-resources.command.ts`, 2 new for `dead-resource-presenters.ts`), 9 new `dead-resources-domain` tests, 5 new `dead-resources-application` tests, 8 new `dead-resources-infrastructure-aws-adapter` tests — 22 new tests total, zero regressions in the existing 438+240+43 cost-waste-side tests.
