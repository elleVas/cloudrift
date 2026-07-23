# ADR-0081: `resource-security` as a new parallel domain

- **Status:** Accepted (2026-07-23)

## Context

`dead-resources` ([ADR-0078](0078-dead-resources-parallel-domain.md)/[ADR-0079](0079-dead-resources-global-scope-scanners.md)) widened cloudrift's scope from "cost waste" to "anything dead/unused in the account," but explicitly drew a line around security-posture checks: "root senza MFA" and similar findings are configuration-of-security-posture checks, not abandoned/unused objects, and were deliberately left out of that domain (see the "Nota — non estende automaticamente allo scope 'security'" note added to the `dead-resources` scope decision).

A follow-up scoping pass (2026-07-23) confirmed and expanded this: 14 read-only security-posture checks across five categories — IAM/account-level (root MFA, user MFA, access-key rotation, root access keys, password policy), network exposure (open ingress, permissive default security groups), public storage (S3 buckets, EBS snapshots), encryption at rest (EBS, RDS, S3), and visibility/audit (RDS public accessibility, CloudTrail multi-region coverage). All read-only (`Describe*`/`Get*`/`List*` IAM actions only), consistent with the project's "never deletes/modifies/stops" disclaimer.

## Decision

**Three new Nx libraries**, mirroring `dead-resources-{domain,application,infrastructure/aws-adapter}`'s exact layout and hexagonal layering ([ADR-0013](0013-ddd-hexagonal-plugin-model.md), [ADR-0078](0078-dead-resources-parallel-domain.md)):

- `resource-security-domain` (`libs/resource-security/domain`, `scope:domain`)
- `resource-security-application` (`libs/resource-security/application`, `scope:application`)
- `resource-security-infrastructure-aws-adapter` (`libs/resource-security/infrastructure/aws-adapter`, `scope:infrastructure`)

**New domain model**, deliberately not reusing `dead-resources-domain`'s types — these findings describe risky configuration on actively-used resources, not abandoned ones:

```ts
export type ResourceSecuritySeverity = 'info' | 'warning' | 'critical';
export interface SecurityFinding {
  readonly id: string;
  readonly kind: ResourceSecurityKind;
  readonly region?: AwsRegion; // optional: account-wide/global-scope kinds have none
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  readonly riskReason: string; // instead of hygieneReason
  readonly severity: ResourceSecuritySeverity;
}
```

`ResourceSecurityScannerPort`, `FindResourceSecurityFindingsUseCasePort`/`FindResourceSecurityFindingsUseCase`, and the `scope: 'regional' | 'global'` job-splitting coordinator all mirror their `dead-resources-*` counterparts verbatim in shape and behavior (8 of the 14 kinds are global-scope: the 5 IAM/account-level checks, both S3 checks, and CloudTrail — S3's `ListBuckets` and IAM/CloudTrail's account-wide view have no meaningful per-region split).

**`ResourceSecurityPolicy<T>` deliberately omits `DeadResourcePolicy`'s grace-period/`minAgeDays` machinery.** A hygiene finding ("this key pair hasn't been touched in N days") legitimately needs a settling-in period; a security misconfiguration (open ingress, no MFA, an unencrypted volume) is a risk from the moment it exists, so gating findings behind an age threshold would misrepresent the risk. Only the tag-exclusion logic (`ignoreTag`/`excludeTagValues`) carries over. The one kind that does need an age threshold (`iam-access-key-rotation-overdue`, CIS AWS Foundations 1.14: rotate every 90 days) computes it in its own `judge()` using the `now` parameter, rather than adding grace-period fields every other kind would have to ignore.

**All 14 kinds implemented in one pass** (unlike `dead-resources`' incremental single-kind-first rollout in ADR-0078): the scope was already fully enumerated and confirmed before implementation started, so there was no discovery risk to de-risk against.

| Category | Kind | Scope |
|---|---|---|
| IAM/account | `iam-root-mfa-disabled` | global |
| IAM/account | `iam-user-mfa-disabled` | global |
| IAM/account | `iam-access-key-rotation-overdue` | global |
| IAM/account | `iam-root-access-key-active` | global |
| IAM/account | `iam-password-policy-weak` | global |
| Network | `ec2-security-group-open-ingress` | regional |
| Network | `ec2-default-security-group-permissive` | regional |
| Public storage | `s3-bucket-public` | global |
| Public storage | `ec2-snapshot-public` | regional |
| Encryption | `ec2-volume-unencrypted` | regional |
| Encryption | `rds-instance-unencrypted` | regional |
| Encryption | `s3-bucket-encryption-missing` | global |
| Visibility/audit | `rds-instance-publicly-accessible` | regional |
| Visibility/audit | `cloudtrail-not-multiregion` | global |

**CLI**: a new top-level `cloudrift resource-security` command (`--regions`, `--account-id`, `--ignore-tag`, `--scanners`, `--format table|json`, `--pdf`, `--silent`) — no `--min-age-days` (no grace-period concept, see above). Its own composition root (`resource-security.composition.ts`) and presenter/formatter set (`resource-security-presenters.ts`, table/json/PDF formatters, all reusing `pdf-shared.ts` per [ADR-0072](0072-pdf-shared-layout-module.md)) following the exhaustive-switch dispatch pattern ([ADR-0059](0059-presenter-dispatch-exhaustive-switch.md)). Wired into the wizard as a fifth `WizardMode` (`mode-picker.wizard.ts`), with its own flat, non-categorized multi-select (`resource-security-selection.wizard.ts`) — same shape and same "don't force a category taxonomy" reasoning as `dead-resource-selection.wizard.ts`.

## Alternatives Considered

- **Fold into `dead-resources`.** Rejected per the "Nota" already recorded against that domain's scope: these are security-posture checks on in-use resources, not abandoned ones — reusing `hygieneReason`/`DeadResourceSeverity` would misdescribe every finding.
- **Fold into `analyze` via a flag.** Rejected for the same reason ADR-0078 rejected this for `dead-resources`: conflates domains with different report semantics in one output.
- **Sub-module inside `dead-resources-domain`.** Rejected: would blur that domain's own "sole inbound boundary" invariant and force sharing grace-period machinery this domain deliberately doesn't want.

## Consequences

**Known, deliberate duplication**, same tradeoff ADR-0078 already accepted: `paginate()`, `mapWithConcurrency()`, `createAwsClientConfig()`, and `AwsAdapterError` are copied verbatim into `resource-security-infrastructure-aws-adapter` rather than imported from `dead-resources-infrastructure-aws-adapter`. Revisit (move to `shared-kernel`) only if a fourth AWS-touching infrastructure lib needs the same utilities.

**New IAM permission, `cloudtrail:DescribeTrails`, plus five more from services already granted for other domains** (`iam:GetAccountSummary`, `iam:ListMFADevices`, `iam:GetAccountPasswordPolicy`, four `s3:Get*` actions, `ec2:DescribeSnapshotAttribute`) — see [iam-permissions.md](../en/iam-permissions.md). `@aws-sdk/client-cloudtrail` is a new root dependency; every other AWS SDK client this domain uses (`client-iam`, `client-ec2`, `client-s3`, `client-rds`) was already a dependency.

**No LocalStack e2e coverage yet** — same gap `dead-resources` has (ADR-0079's rationale applies unchanged): several checks here (root MFA, password policy, CloudTrail multi-region) describe account-wide state LocalStack Community doesn't model faithfully. Verified instead via unit tests (47 domain + 7 application + 70 infrastructure-adapter tests, all with mocked AWS SDK clients) and manual review; no contract-fixture harness was added for this domain (unlike `dead-resources-contract.spec.ts`) since the per-scanner unit specs already exercise realistic response shapes end-to-end through scan → policy.

**No new god-file risk.** `resource-security.composition.ts`'s `buildScanners()` is a plain 14-entry array, same shape as `dead-resources.composition.ts`'s pre-split array — well under the 43-entry threshold that justified splitting the cost-waste registry ([ADR-0077](0077-scanner-registry-split-on-pricing-seam.md)).

Verified via `pnpm nx run-many --target={lint,test,build} --all`: all projects green, 47 new `resource-security-domain` tests, 7 new `resource-security-application` tests, 70 new `resource-security-infrastructure-aws-adapter` tests, 30 new CLI tests (`resource-security.command.spec.ts`, `resource-security-presenters.spec.ts`, `resource-security-report.pdf-formatter.spec.ts`) — zero regressions in the existing suite.
