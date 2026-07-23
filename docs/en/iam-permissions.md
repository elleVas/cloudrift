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
    "ec2:DescribeSecurityGroups",
    "ec2:DescribeRegions",
    "iam:ListUsers",
    "iam:ListAccessKeys",
    "iam:GetAccessKeyLastUsed",
    "iam:ListPolicies",
    "iam:ListRoles",
    "iam:ListInstanceProfiles",
    "logs:DescribeLogGroups",
    "acm:ListCertificates",
    "route53:ListHostedZones",
    "cloudformation:DescribeStacks",
    "s3:ListAllMyBuckets",
    "s3:ListBucket",
    "cloudwatch:DescribeAlarms",
    "sns:ListTopics",
    "sns:ListSubscriptionsByTopic",
    "events:ListRules",
    "events:ListTargetsByRule",
    "ecr:DescribeRepositories",
    "ecr:DescribeImages",
    "states:ListStateMachines",
    "states:ListExecutions"
  ],
  "Resource": "*"
}
```

`ec2:DescribeInstances`/`ec2:DescribeNetworkInterfaces` (already in the main policy above) are reused to cross-reference key pairs against running/stopped instances and security groups against network interfaces, respectively. None of these actions are needed for `analyze` — only for `dead-resources`. `s3:ListBucket` (a bucket-level, not account-level, action) is what backs each `s3-bucket-empty` check's `ListObjectsV2` call — a bucket policy that denies it to this principal makes that one bucket unreadable, not the whole scan (see `aws-s3-bucket-empty.scanner.ts`'s per-bucket skip-on-error behavior). `ec2:DescribeRegions` and the reused `ec2:DescribeInstances` are what back `iam-instance-profile-unattached`'s account-wide, all-region cross-reference (see `aws-iam-instance-profile-unattached.scanner.ts`'s doc comment for why this one check deliberately ignores `--regions`) — a region this principal can't `DescribeInstances` in is skipped for that check, not treated as a scan failure.
