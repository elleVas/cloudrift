# Permessi IAM necessari

> 🇬🇧 [English version](../en/iam-permissions.md)

Il principal AWS deve avere le seguenti permission in sola lettura:

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeVolumes",
    "ec2:DescribeAddresses",
    "ec2:DescribeInstances",
    "ec2:DescribeSnapshots",
    "ec2:DescribeImages",
    "ec2:DescribeNatGateways",
    "ec2:DescribeNetworkInterfaces",
    "ec2:DescribeLaunchTemplates",
    "ec2:DescribeLaunchTemplateVersions",
    "cloudwatch:GetMetricStatistics",
    "rds:DescribeDBInstances",
    "rds:DescribeDBClusters",
    "rds:DescribeDBSnapshots",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "logs:DescribeLogGroups",
    "s3:ListAllMyBuckets",
    "s3:GetBucketLifecycleConfiguration",
    "s3:ListMultipartUploadParts",
    "s3:ListBucketMultipartUploads",
    "ecr:DescribeRepositories",
    "ecr:DescribeImages",
    "secretsmanager:ListSecrets",
    "lambda:ListFunctions",
    "elasticfilesystem:DescribeFileSystems",
    "dynamodb:ListTables",
    "dynamodb:DescribeTable",
    "elasticache:DescribeCacheClusters",
    "sagemaker:ListNotebookInstances",
    "sagemaker:ListEndpoints",
    "sagemaker:DescribeEndpoint",
    "sagemaker:DescribeEndpointConfig",
    "sagemaker:ListEndpointConfigs",
    "sagemaker:ListModels",
    "sagemaker:DescribeModel",
    "sagemaker:ListTags",
    "sqs:ListQueues",
    "sqs:GetQueueAttributes",
    "sqs:ListDeadLetterSourceQueues",
    "sqs:ListQueueTags",
    "tag:GetResources",
    "eks:ListClusters",
    "eks:ListNodegroups",
    "eks:DescribeNodegroup",
    "sts:GetCallerIdentity"
  ],
  "Resource": "*"
}
```

> `--live-pricing` richiede in più `pricing:GetProducts` (AWS Pricing API). **Non** serve per il pricing statico di default.

> I comandi `cost`/`trend` (confronto e trend di spesa via AWS Cost Explorer) richiedono in più `ce:GetCostAndUsage`. **Non** serve per `analyze`. A differenza di tutto il resto di questa policy, questa è una chiamata **fatturata** ($0.01/richiesta) — vedi [la doc di `cost`/`trend`](utilizzo.md#cost--trend--confronto-e-trend-di-spesa).

Il comando `dead-resources` (check di hygiene per risorse morte/inutilizzate, vedi [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md), riferimento completo dei flag in [utilizzo.md](utilizzo.md#dead-resources--hygiene-per-risorse-morteinutilizzate)) richiede in più:

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeKeyPairs",
    "ec2:DescribeReservedInstances",
    "iam:ListUsers",
    "iam:ListAccessKeys",
    "iam:GetAccessKeyLastUsed",
    "iam:ListPolicies"
  ],
  "Resource": "*"
}
```

`ec2:DescribeInstances` (già nella policy principale sopra) viene riusata per incrociare le key pair con le istanze in esecuzione/ferme. Nessuna delle action `iam:*` serve per `analyze` — solo per `dead-resources`.
