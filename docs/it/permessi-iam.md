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
    "codepipeline:ListPipelines",
    "codepipeline:ListPipelineExecutions",
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

`ec2:DescribeInstances`/`ec2:DescribeNetworkInterfaces` (già nella policy principale sopra) vengono riusate rispettivamente per incrociare le key pair con le istanze in esecuzione/ferme e i security group con le network interface. Nessuna di queste action serve per `analyze` — solo per `dead-resources`. `s3:ListBucket` (action a livello di singolo bucket, non a livello account) è quella dietro la chiamata `ListObjectsV2` di ogni check `s3-bucket-empty` — una bucket policy che la nega a questo principal rende illeggibile solo quel bucket, non l'intera scansione (vedi il comportamento di skip-per-errore in `aws-s3-bucket-empty.scanner.ts`). `ec2:DescribeRegions` e la riusata `ec2:DescribeInstances` sono ciò che sta dietro l'incrocio account-wide, su tutte le regioni, di `iam-instance-profile-unattached` (vedi il commento in `aws-iam-instance-profile-unattached.scanner.ts` sul perché questo check ignora deliberatamente `--regions`) — una regione in cui questo principal non può fare `DescribeInstances` viene saltata per quel check, non trattata come un fallimento della scansione.

Il comando `resource-security` (check di postura di sicurezza — hygiene IAM/account, esposizione di rete, storage pubblico, crittografia a riposo, visibilità/audit; vedi [ADR-0081](../adr/0081-resource-security-parallel-domain.md), riferimento completo dei flag in [utilizzo.md](utilizzo.md#resource-security--scansione-della-postura-di-sicurezza)) richiede in più:

```json
{
  "Effect": "Allow",
  "Action": [
    "iam:GetAccountSummary",
    "iam:ListMFADevices",
    "iam:GetAccountPasswordPolicy",
    "s3:GetBucketAcl",
    "s3:GetBucketPolicyStatus",
    "s3:GetPublicAccessBlock",
    "s3:GetBucketEncryption",
    "ec2:DescribeSnapshotAttribute",
    "cloudtrail:DescribeTrails"
  ],
  "Resource": "*"
}
```

`iam:ListUsers`, `iam:ListAccessKeys`, `ec2:DescribeSecurityGroups`, `ec2:DescribeVolumes`, `ec2:DescribeSnapshots`, `s3:ListAllMyBuckets` e `rds:DescribeDBInstances` (già presenti nella policy principale o nel blocco `dead-resources` sopra) vengono riusate — questo comando non aggiunge nuove chiamate di hygiene/inventario, solo le verifiche read-only (`Get*`/`DescribeSnapshotAttribute`/`DescribeTrails`) necessarie per valutare la configurazione di sicurezza di ogni risorsa. `cloudtrail:DescribeTrails` è l'unica action di un servizio non altrimenti usato da cloudrift. Nessuna di queste action serve per `analyze` o `dead-resources` — solo per `resource-security`.
