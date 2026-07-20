# Vertical scanners (Phase 6)

> 🇮🇹 [Versione italiana](../it/scanner-verticali-guida.md)

Phase 6 added 9 `ResourceKind`s across 5 verticals on top of the 29 generalist scanners: event-driven hygiene (SQS/Lambda), Aurora Serverless v2, the SageMaker suite, Dev/PR ghost environments, and EKS cost visibility. Rationale and alternatives considered are in [ADR-0065](../adr/0065-vertical-premium-scanners-phase-6-strategy.md) (overall strategy) and [ADR-0066](../adr/0066-eks-scanners-aws-api-only-kubeconfig-deferred.md) (EKS specifically). This doc is the practical reference: what each scanner flags, its accuracy ceiling, and how to tune it — the README's [What it detects](../../README.md#what-it-detects) table has the one-line summary and cost formula for each.

Run any of them standalone with `--scanners <kind>`, e.g.:

```sh
node apps/cli/dist/main.js analyze --scanners eks-node-overprovisioned --live-pricing
```

## Serverless orphans

**`sqs-dlq-abandoned`** — an SQS queue identified as a Dead Letter Queue (via its `RedrivePolicy`, being referenced as the target of another queue's redrive policy, or a `*-dlq`/`*-dead-letter` name match) whose oldest unconsumed message is older than 14 days. This is a `$0` hygiene flag, same rationale as the `eni-orphaned` scanner: SQS has no storage cost, the value is catching ignored errors and dead integrations, not a dollar saving.

**`lambda-loggroup-orphaned`** — a CloudWatch Log Group under `/aws/lambda/` whose Lambda function no longer exists. Distinct from the generalist `log-group` scanner, which flags *missing retention* on log groups that still belong to a live function; this one flags log groups whose owning function is gone entirely. Cost is the stored log data at the standard CloudWatch Logs storage rate.

No dedicated config thresholds beyond the standard `--min-age-days` / `cloudrift:ignore` tag.

## Aurora Serverless v2

**`aurora-serverless-overprovisioned`** — an Aurora Serverless v2 cluster whose `MinACU` floor sits well above the peak `ServerlessDatabaseCapacity` actually observed over a 7-day window. The suggested Min ACU is `ceil(peakACU * 1.2)` — 20% headroom above the observed peak, not right at the edge. Saving is `(MinACU − suggestedMinACU) × $87.60/ACU-month` (the static `aurora-acu` price key, `$0.12/ACU-hour`).

Config: `thresholds.auroraMinAcuUtilizationPercent` (default `50`) — flagged when peak ACU is below this percentage of the Min ACU floor.

**Risk:** a rare weekly peak that falls outside the 7-day window looks like permanent overprovisioning. The 20% suggested-floor headroom is the mitigation, not a guarantee — verify against a longer observation window for spiky workloads before lowering Min ACU.

## SageMaker suite

Three scanners, meant to be read together — a model lifecycle view (notebook → endpoint → orphaned artifact):

**`sagemaker-notebook-idle`** (gated on `--live-pricing`) — a notebook instance `InService` with max CPU ≤ `thresholds.sagemakerNotebookCpuPercent` (default `2`) over a 7-day window.

> **Caveat:** CPU-only. GPU notebook instances can cost hundreds to thousands of dollars a day and this check says nothing about GPU utilization — it also can't tell "idle kernel" from "someone reading a notebook without running cells." Treat a finding as "go check this," not as confirmed waste.

**`sagemaker-endpoint-idle`** (gated on `--live-pricing`) — an endpoint `InService` with zero `Invocations` summed over a 7-day window. Cost is the full instance-hour cost across every production variant's instance count.

**`sagemaker-training-orphaned`** — a registered SageMaker Model not referenced by any Endpoint Config (`sagemaker:ListModels` cross-referenced against `sagemaker:ListEndpointConfigs`). This is namespace hygiene, not a direct SageMaker cost (a Model resource itself is free) — the estimated cost is the S3 Standard storage of `ModelDataUrl`, priced via the existing `s3-standard` key.

**Risk:** a model kept around deliberately for rollback/backup looks identical to a truly abandoned one from the AWS-API-only view; the grace period (`--min-age-days`) is the only mitigation.

## Dev/PR ghost environments

**`environment-ghost`** — groups resources (EC2, RDS, Lambda, Load Balancers) by a tag value or a naming-pattern match, then flags a group as a "ghost environment" only when *every* resource in it has been inactive for `environmentDetection.inactivityDays` (default `7`) or longer.

Config (`cloudriftrc` / `cloudrift.config.json`):

```json
{
  "environmentDetection": {
    "tagKeys": ["Environment", "env", "branch"],
    "namingPatterns": ["*-pr-*", "*-preview-*", "*-dev-*", "*-feat-*"],
    "inactivityDays": 7
  }
}
```

`tagKeys` is tried first (`resourcegroupstaggingapi:GetResources`, grouped by tag value); `namingPatterns` is the fallback for resources without a matching tag. This is the most experimental scanner in Phase 6 — it depends entirely on your account's tagging/naming discipline, and a team with neither will see nothing. Start by adding a `tagKeys` entry that matches how your org actually tags ephemeral environments before trusting the naming-pattern fallback.

## EKS cost visibility

Both scanners are **AWS-API-only** — no kubeconfig, no cluster-internal connectivity, ever. See [ADR-0066](../adr/0066-eks-scanners-aws-api-only-kubeconfig-deferred.md) for why: requiring cluster RBAC read access would break the "just an IAM role" trust model that's central to how cloudrift is used. The tradeoff is a real accuracy ceiling — read both caveats below before acting on either finding.

**`eks-node-overprovisioned`** (gated on `--live-pricing`) — an EKS Node Group whose CPU requested-to-allocatable ratio, per CloudWatch **Container Insights** node-level aggregates (`node_cpu_request`/`node_cpu_limit`, namespace `ContainerInsights`), is below `thresholds.eksNodeUtilizationPercent` (default `30`) over a 7-day window. The suggested node count scales down toward a 70%-target utilization, never below 1 node and never above the current count (`suggestNodeCount` in the scanner). Saving is `(nodeCount − suggestedNodeCount) × <instance type monthly price>`.

If Container Insights isn't enabled on a cluster, the scanner degrades gracefully — it emits a scan warning and produces **no finding** for that cluster, rather than guessing from missing data.

> **Caveat:** this reads Node-group-level aggregates only, never individual Pod `resources.requests`/`resources.limits` — it cannot tell you *which* Pods are oversized, only that the group as a whole looks overprovisioned. A `KubernetesDataPort` for Pod-level accuracy is an explicit, undefined-for-now extension point for a future phase (ADR-0066), not something to expect from this scanner today.

**`eks-orphan-pvc`** — an EBS volume provisioned for a Kubernetes PersistentVolumeClaim (identified via the CSI driver's `kubernetes.io/created-for/pvc/name` tag) that is either:
- unattached (`state: available`), or
- still tagged for an EKS cluster that no longer exists, via the legacy in-tree provisioner's `kubernetes.io/cluster/<name>` tag correlated against `eks:ListClusters`.

Cost uses the same static EBS pricing table as the `ebs-volume` scanner (no `--live-pricing` needed).

> **Caveat:** the cluster-name tag is a legacy in-tree-provisioner convention. Volumes provisioned by the modern EBS CSI driver without `--extra-tags` carry no recoverable cluster name — those volumes are only ever caught by the unattached check, never the deleted-cluster one. This is not a bug to fix; it's a hard limit of reading tags instead of talking to the Kubernetes API.

## IAM permissions

All 9 scanners' required actions are already folded into the README's [Required IAM permissions](../../README.md#required-iam-permissions) policy block: `sqs:ListQueues`/`GetQueueAttributes`/`ListDeadLetterSourceQueues`/`ListQueueTags`, `rds:DescribeDBClusters`, `tag:GetResources`, `eks:ListClusters`/`ListNodegroups`/`DescribeNodegroup`, plus the pre-existing `sagemaker:*` read actions. `eks-node-overprovisioned` and the SageMaker idle scanners additionally need `pricing:GetProducts` when run with `--live-pricing`, same as every other per-instance-type-priced scanner.
