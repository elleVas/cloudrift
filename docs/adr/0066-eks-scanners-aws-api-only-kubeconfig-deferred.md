# ADR-0066: EKS scanners — AWS API only, kubeconfig deferred

- **Status:** Accepted (2026-07-14)

## Context

The two EKS scanners in [ADR-0065](0065-vertical-premium-scanners-phase-6-strategy.md) (`eks-node-overprovisioned`, `eks-orphan-pvc`) need to answer "is this node group/volume actually used by the workloads scheduled on it?" — a question that, at full fidelity, requires reading Pod-level `resources.requests`/`resources.limits` from the Kubernetes API itself. cloudrift's entire scanning model, however, is a read-only AWS API client with IAM credentials ([SECURITY.md](../../SECURITY.md)); it has never required network access to anything other than AWS endpoints, no cluster-internal connectivity, no kubeconfig, no in-cluster agent.

Reading Pod-level data would mean either (a) requiring a kubeconfig with cluster RBAC read access, breaking the "just an IAM role, nothing else" trust story that's central to cloudrift's positioning (see the marketing/trust-factor backlog point about permissions), or (b) deploying an in-cluster read-only agent, which is a fundamentally different product surface (an in-cluster component, not a CLI you point at an AWS account).

## Decision

Both EKS scanners are **AWS-API-only** for this phase:

- `eks-node-overprovisioned` uses `eks:ListClusters` → `eks:ListNodegroups` → `eks:DescribeNodegroup`, plus CloudWatch **Container Insights** metrics (namespace `ContainerInsights`: `node_cpu_request`, `node_cpu_limit`, `node_cpu_utilization`, and the memory equivalents) if the cluster has Container Insights enabled. If it isn't enabled, the scanner degrades gracefully: it emits a warning (surfaced the same way as other soft scan errors, [ADR-0018](0018-scan-errors-per-scanner-region.md)) and produces no finding for that cluster, rather than guessing.
- `eks-orphan-pvc` uses `ec2:DescribeVolumes` filtered on the CSI driver's own tag convention (`kubernetes.io/created-for/pvc/name`), correlating orphan status via two AWS-visible signals only: volume `state = available` (PVC/PV deleted but EBS volume left behind), or a tagged cluster name that no longer resolves via `eks:ListClusters` (cluster torn down, volume orphaned).

Neither scanner sees individual Pod requests/limits, only Node-group-level aggregates (Container Insights) or EBS/tag-level state. This is an explicit accuracy ceiling, documented as a caveat in each scanner's presenter output, not something to work around within this phase.

A future `KubernetesDataPort` (kubeconfig-based, in-cluster or via the EKS API's Kubernetes-aware endpoints) is left as an explicit extension point — an optional collaborator, undefined for now — for a later phase, once there's a decision on whether cloudrift takes on cluster-internal read access as a supported capability.

## Alternatives Considered

- **Require kubeconfig from the start, read Pod-level requests/limits directly.** Rejected: breaks the AWS-API-only / IAM-only trust model that's core to cloudrift's current positioning, and turns "point cloudrift at an AWS account" into "point cloudrift at an AWS account and hand it cluster RBAC" — a materially bigger ask for a Phase 6 experiment whose value isn't yet proven.
- **Skip EKS entirely until kubeconfig support is designed.** Rejected: Container Insights + tag-based volume correlation already answers "is this node group grossly overprovisioned" and "is this volume orphaned" at a coarse but real level — useful signal today, not blocked on a bigger, unscoped kubeconfig decision.
- **Silently estimate Pod-level usage from Node-level metrics (divide by pod count, etc.).** Rejected: would fabricate a false precision the data doesn't support; the chosen approach instead surfaces the real Container-Insights-level aggregate and documents the limitation explicitly.

## Consequences

- `eks-node-overprovisioned` finding accuracy is bounded by Container Insights being enabled on the target cluster — a real-world gap (Container Insights is opt-in and has its own cost), documented as the scanner's primary risk in the plan's risk matrix and repeated in its presenter caveat.
- No new runtime dependency (no Kubernetes client library, no kubeconfig parsing) added to `apps/cli` or the aws-adapter package in this phase.
- IAM policy additions are `eks:ListClusters`, `eks:ListNodegroups`, `eks:DescribeNodegroup`, `eks:DescribeCluster` — all read-only, consistent with the rest of the IAM policy block in the README.
- Phase 7 (not scoped, not started) is the natural place to revisit a `KubernetesDataPort` if Pod-level accuracy becomes a requested feature.
