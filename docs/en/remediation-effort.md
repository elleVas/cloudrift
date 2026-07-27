# Remediation effort per resource kind

> 🇮🇹 [Versione italiana](../it/livello-sforzo.md)

Every waste `ResourceKind` carries an `effort` rating (`low` / `medium` / `high`) alongside its `category`/`estimated` metadata. It feeds the PDF report's "Top quick wins" ranking — sorted by a cost-vs-effort score, not raw monthly cost alone — so the first items a reader sees are cheap-to-fix, not just expensive.

**Criteria:**

- **low** — pure delete/detach of a resource nothing else references, no dependents by construction, reversible or near-zero risk.
- **medium** — needs verification before acting (the scan's "idle"/"unused" call could be wrong) or is an in-place config change with no downtime but some secondary effect.
- **high** — needs downtime, data migration, or coordination with another team/service that may depend on the resource silently.

| Kind | Effort | Why |
|---|---|---|
| `ebs-volume` | low | Volume already unattached, zero dependents |
| `elastic-ip` | low | IP already unassociated |
| `rds-instance` | **high** | Database: data risk, needs a snapshot + verification + coordination |
| `load-balancer` | medium | Verify no client still points at the DNS name |
| `ec2-instance` | medium | Verify before terminating; reversible via an AMI |
| `ebs-snapshot` | low | Old/redundant snapshot |
| `nat-gateway` | medium | Affects a whole subnet's egress path if misclassified |
| `ebs-gp2-upgrade` | low | In-place volume-type change, zero downtime |
| `ebs-idle` | low | Same reasoning as `ebs-volume` |
| `ec2-underutilized` | medium | Resize needs a stop/start, brief downtime |
| `rds-underutilized` | **high** | Resizing RDS usually needs a maintenance window |
| `log-group` | low | No runtime impact |
| `eni-orphaned` | low | Network interface already unattached |
| `s3-no-lifecycle` | low | Adding a lifecycle rule is config-only, zero downtime |
| `lambda-underutilized` | low | Memory change is config-only, zero downtime |
| `efs-unused` | medium | Verify no intermittent mounts before deleting |
| `dynamodb-overprovisioned` | low | Online throughput change, zero downtime |
| `elasticache-idle` | medium | Cache clusters are often silently shared by other apps |
| `redshift-idle-cluster` | **high** | Data warehouse — verify no BI tool depends on it |
| `opensearch-idle-domain` | medium | Verify dependent apps; reversible via snapshot |
| `msk-idle-cluster` | **high** | Messaging infra often has hidden consumers |
| `fsx-idle-filesystem` | medium | Verify mounts before deleting |
| `documentdb-idle-instance` | **high** | Database, same reasoning as `rds-instance` |
| `neptune-idle-instance` | **high** | Graph database, same reasoning |
| `mq-idle-broker` | medium | Verify apps depending on the queue |
| `workspaces-idle` | low | Low per-user blast radius, re-provisionable |
| `vpn-connection-idle` | medium | Network connectivity, needs the network team's input |
| `transit-gateway-idle-attachment` | medium | Network routing, needs verification |
| `kinesis-provisioned-idle-stream` | medium | Verify producers/consumers before deleting |
| `sqs-dlq-abandoned` | low | $0 queue, pure hygiene |
| `lambda-loggroup-orphaned` | low | No runtime impact |
| `aurora-serverless-overprovisioned` | medium | Min ACU change is online but affects the scaling floor |
| `sagemaker-notebook-idle` | low | Isolated single-user dev notebook |
| `sagemaker-endpoint-idle` | **high** | A serving endpoint — if misclassified, breaks a production ML integration |
| `sagemaker-training-orphaned` | low | Model with no active endpoint, zero risk |
| `environment-ghost` | medium | Multiple resources at once, but already inactive by definition |
| `eks-node-overprovisioned` | **high** | Affects the whole cluster's scheduling capacity |
| `eks-orphan-pvc` | low | No pod references it by construction |
| `ami-unused` | low | Unused AMI, zero dependents |
| `ecr-image-untagged` | low | No deployment references untagged digests |
| `s3-multipart-upload-abandoned` | low | Pure cleanup, zero risk |
| `rds-manual-snapshot-old` | low | Old snapshot, same reasoning as `ebs-snapshot` |
| `secretsmanager-unused` | medium | A secret can have indirect dependents that are hard to verify |
| `codepipeline-pipeline-stale` | low | No runtime impact, re-creatable from source |
