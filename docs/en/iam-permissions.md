# Required IAM permissions

> 🇮🇹 [Versione italiana](../it/permessi-iam.md)

The AWS principal needs the following read-only permissions:

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

> `--live-pricing` additionally requires `pricing:GetProducts` (the AWS Pricing API). It is **not** needed for the default static pricing.

> The `cost`/`trend` commands (spend comparison and monthly trend via AWS Cost Explorer) additionally require `ce:GetCostAndUsage`. It is **not** needed for `analyze`. Unlike everything else in this policy, this is a **billed** API call ($0.01/request) — see the [`cost`/`trend` docs](usage.md#cost--trend--spend-comparison-and-monthly-trend).

The `dead-resources` command (dead/unused resource hygiene checks, see [ADR-0078](../adr/0078-dead-resources-parallel-domain.md)/[ADR-0079](../adr/0079-dead-resources-global-scope-scanners.md), full flag reference in [usage.md](usage.md#dead-resources--deadunused-resource-hygiene)) additionally requires:

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

`ec2:DescribeInstances` (already in the main policy above) is reused to cross-reference key pairs against running/stopped instances. None of the `iam:*` actions are needed for `analyze` — only for `dead-resources`.
