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
