# ADR-0065: Vertical premium scanners — Phase 6 strategy

- **Status:** Accepted (2026-07-14)

## Context

cloudrift covers 29 resource kinds with a generalist approach: EBS, EC2, RDS, networking, and a broad set of "idle/underutilized" scanners added through v0.4.0/v0.5.0. That breadth is complete enough that the next unit of differentiation isn't a 30th generalist scanner — it's depth in niches native AWS tools (Cost Explorer, Compute Optimizer) don't look at: Kubernetes (EKS), AI/ML (SageMaker), serverless database (Aurora Serverless v2), ephemeral environments (Dev/PR), and event-driven hygiene (SQS DLQs, orphaned Lambda log groups).

The existing `WasteScannerPort` + `WastePolicy` + declarative scanner registry ([ADR-0043](0043-declarative-scanner-registry.md)) already makes adding a scanner a mechanical, testable operation — no changes needed to the use case, DTO, or report layer. This is what makes 8 new scanners across 5 verticals tractable as a single phase rather than 8 separate initiatives.

## Decision

Phase 6 adds 8 new `ResourceKind`s across 5 verticals, built incrementally (each phase independently demoable via `analyze --scanners <kind>`):

1. **Serverless orphans** — `sqs-dlq-abandoned` (stagnant SQS DLQs, $0 hygiene finding, same rationale as [ADR-0004](0004-orphaned-eni-included.md)'s $0 ENI scanner) and `lambda-loggroup-orphaned` (CloudWatch log groups under `/aws/lambda/` whose function no longer exists — distinct from the existing `log-group` scanner, which flags missing retention on log groups that still belong to a live function).
2. **Aurora Serverless v2** — `aurora-serverless-overprovisioned` (Min ACU set well above real peak usage).
3. **SageMaker suite** — `sagemaker-notebook-idle`, `sagemaker-endpoint-idle` (both gated behind `--live-pricing`, per-instance pricing), `sagemaker-training-orphaned` (models never attached to an endpoint).
4. **Dev/PR ghost environments** — `environment-ghost`, grouping resources by tag or naming-pattern heuristic and flagging groups that are entirely inactive.
5. **EKS cost visibility** — `eks-node-overprovisioned` and `eks-orphan-pvc`, both AWS-API-only (see [ADR-0066](0066-eks-scanners-aws-api-only-kubeconfig-deferred.md)).

All 5 verticals ship in this phase; none is deferred. Execution order follows complexity, not just value: independent/low-complexity scanners first (SQS, Lambda, Aurora, the two SageMaker idle scanners), `sagemaker-training-orphaned` after the SageMaker idle pair (it cross-references their endpoint list), `environment-ghost` as the most experimental/tag-dependent scanner, and the EKS pair last as the highest-complexity, most novel-API surface.

New AWS SDK clients required: `@aws-sdk/client-eks`, `@aws-sdk/client-sagemaker`, `@aws-sdk/client-sqs`, `@aws-sdk/client-resource-groups-tagging-api`. All read-only IAM actions, consistent with the existing threat model (`SECURITY.md`).

A SaaS-readiness hint is documented separately in [ADR-0067](0067-saas-readiness-architectural-hints.md) — it is a forward-looking note, not part of this phase's implementation.

## Alternatives Considered

- **Pick a subset of the 5 verticals for this phase, defer the rest.** Rejected: each vertical is small in isolation (1-3 scanners) and they don't share a natural "do 3 now, 2 later" split — splitting would mean two ADRs and two review passes for work that's already fully scoped in one plan (`docs/todo/piano-scanner-verticali.md`).
- **A generic "resource-groups-tagging-api" based scanner covering all 5 niches via tags alone**, instead of dedicated per-service scanners. Rejected: EKS and SageMaker waste signals come from CloudWatch/Container Insights metrics and service-specific describe calls, not from tags — a single generic scanner couldn't express the different waste conditions (idle CPU, zero invocations, orphaned PVC state) without becoming an if/else pile that defeats the point of the `WastePolicy` abstraction.

## Consequences

- `ResourceKind` grows from 29 to 37 values; the scanner registry ([ADR-0043](0043-declarative-scanner-registry.md)) gains 8 entries (2 in the live-pricing-gated array: `sagemaker-notebook-idle`, `sagemaker-endpoint-idle`, `eks-node-overprovisioned`; the rest always-on).
- 4 new AWS SDK dependencies, 4 new IAM read permissions groups (`eks:*`, `sagemaker:*`, `sqs:*`, `tag:GetResources`) documented in the README's IAM policy block.
- `cloudrift.config.example.json` gains new threshold/config keys: `auroraMinAcuUtilizationPercent`, `eksNodeUtilizationPercent`, `environmentDetection.{tagKeys,namingPatterns,inactivityDays}`.
- No changes to `AnalyzeCloudWasteUseCase`, DTO shape, or the report/presenter dispatch mechanism ([ADR-0059](0059-presenter-dispatch-exhaustive-switch.md)) beyond adding new cases to the exhaustive switch.
- `environment-ghost` carries the highest false-positive risk of the 8 (teams without consistent tagging); documented with a caveat and a naming-pattern fallback rather than blocked on tagging discipline.
