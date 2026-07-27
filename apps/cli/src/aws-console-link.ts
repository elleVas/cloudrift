// SPDX-License-Identifier: Apache-2.0

/**
 * Builds a direct AWS console URL for a finding, given its resource kind,
 * `id` (whatever shape that kind's scanner puts there — bare ID, ARN, or a
 * full URL for the handful of kinds where that's what AWS itself hands
 * back) and region (some kinds are account-wide and have none).
 *
 * Deliberately NOT a flat kind→template record: most AWS console areas
 * host several resource kinds under the same URL shape (one EC2 console,
 * one RDS console, ...), so the builders below are grouped by console area
 * and composed into the kind map at the bottom — the URL shape for a given
 * console is written once, not copy-pasted per kind.
 *
 * Coverage is intentionally partial: 7 kinds return `undefined` because the
 * `id` they carry cannot be turned into a working console URL with the data
 * `WastedResource`/`DeadResource`/`SecurityFinding` expose today (an opaque
 * AWS-internal ID with no derivable name, or an ID that only makes sense
 * alongside a sibling field the public interface doesn't carry) — see the
 * comments by NO_LINK_KINDS below. Emitting a guessed-wrong link would be
 * worse than emitting none.
 *
 * Caveat: AWS periodically reshuffles its console URL fragments (e.g. the
 * ongoing migration of VPC-ish EC2 resources to a dedicated VPC console).
 * These were accurate as of this writing but unlike everything else in this
 * codebase, they can't be verified by a unit test against a real API —
 * spot-check a sample against the live console after any AWS console
 * redesign lands.
 */

interface ConsoleLinkInput {
  readonly kind: string;
  readonly id: string;
  readonly region?: string;
}

type LinkBuilder = (input: ConsoleLinkInput) => string;

// ─── Per-console-area factories (the URL shape is written once here) ────────

function ec2(fragment: string, param: string): LinkBuilder {
  return ({ id, region }) =>
    `https://console.aws.amazon.com/ec2/home?region=${region}#${fragment}:${param}=${encodeURIComponent(id)}`;
}

// AWS has been moving VPC-ish resources (ENIs, NAT GWs, EIPs, VPN/TGW
// attachments, security groups) off the EC2 console onto a dedicated VPC
// console over the last couple of console refreshes.
function vpc(fragment: string, param: string): LinkBuilder {
  return ({ id, region }) =>
    `https://console.aws.amazon.com/vpc/home?region=${region}#${fragment}:${param}=${encodeURIComponent(id)}`;
}

function rds(isCluster: boolean, entity: 'database' | 'snapshot' = 'database'): LinkBuilder {
  return ({ id, region }) =>
    `https://console.aws.amazon.com/rds/home?region=${region}#${entity}:id=${encodeURIComponent(id)};is-cluster=${isCluster}`;
}

// S3's console doesn't require a region to resolve a bucket (bucket names
// are globally unique), so it's included only when the finding has one.
function s3(): LinkBuilder {
  return ({ id, region }) =>
    region
      ? `https://console.aws.amazon.com/s3/buckets/${encodeURIComponent(id)}?region=${region}&tab=objects`
      : `https://console.aws.amazon.com/s3/buckets/${encodeURIComponent(id)}?tab=objects`;
}

function cloudwatchLogGroup(): LinkBuilder {
  return ({ id, region }) => {
    const name = id.includes(':log-group:') ? logGroupNameFromArn(id) : id;
    return `https://console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodeURIComponent(name)}`;
  };
}

function cloudwatchAlarm(): LinkBuilder {
  return ({ id, region }) =>
    `https://console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarmNameFromArn(id))}`;
}

function iamUserByArn(): LinkBuilder {
  return ({ id }) => `https://console.aws.amazon.com/iam/home#/users/details/${encodeURIComponent(afterLastSlash(id))}`;
}

// Direct-usage builders: the console accepts the finding's `id` as-is
// (already an ARN/StackId/queue URL), no parsing needed.
function directPath(base: string, fragment: string, withRegion = true): LinkBuilder {
  return ({ id, region }) =>
    withRegion
      ? `https://console.aws.amazon.com/${base}/home?region=${region}#${fragment}${encodeURIComponent(id)}`
      : `https://console.aws.amazon.com/${base}/home#${fragment}${encodeURIComponent(id)}`;
}

// ─── ARN-string helpers (only used where the id we have is an ARN but the
// console needs the bare resource name out of it) ────────────────────────────

function afterLastSlash(s: string): string {
  return s.slice(s.lastIndexOf('/') + 1);
}

function logGroupNameFromArn(arn: string): string {
  const rest = arn.slice(arn.indexOf(':log-group:') + ':log-group:'.length);
  return rest.endsWith(':*') ? rest.slice(0, -2) : rest;
}

function alarmNameFromArn(arn: string): string {
  return arn.slice(arn.indexOf(':alarm:') + ':alarm:'.length);
}

// ─── Kind → builder map ──────────────────────────────────────────────────────

const BUILDERS: Record<string, LinkBuilder | undefined> = {
  // cloud-cost
  'ebs-volume': ec2('Volumes', 'volumeId'),
  'ebs-gp2-upgrade': ec2('Volumes', 'volumeId'),
  'ebs-idle': ec2('Volumes', 'volumeId'),
  'ebs-snapshot': ec2('Snapshots', 'snapshotId'),
  'rds-manual-snapshot-old': rds(false, 'snapshot'),
  'ec2-instance': ec2('Instances', 'instanceId'),
  'ec2-underutilized': ec2('Instances', 'instanceId'),
  'ami-unused': ec2('Images', 'imageId'),
  'elastic-ip': vpc('Addresses', 'allocationId'),
  'nat-gateway': vpc('NatGateways', 'natGatewayId'),
  'eni-orphaned': vpc('NetworkInterfaces', 'networkInterfaceId'),
  'vpn-connection-idle': vpc('VpnConnections', 'vpnConnectionId'),
  'transit-gateway-idle-attachment': vpc('TransitGatewayAttachments', 'transitGatewayAttachmentId'),
  'rds-instance': rds(false),
  'rds-underutilized': rds(false),
  'aurora-serverless-overprovisioned': rds(true),
  'load-balancer': directPath('ec2', 'LoadBalancers:search='),
  'log-group': cloudwatchLogGroup(),
  'lambda-loggroup-orphaned': cloudwatchLogGroup(),
  's3-no-lifecycle': s3(),
  's3-multipart-upload-abandoned': undefined, // NO_LINK — see below
  'lambda-underutilized': ({ id, region }) =>
    `https://console.aws.amazon.com/lambda/home?region=${region}#/functions/${encodeURIComponent(id)}`,
  'efs-unused': ({ id, region }) =>
    `https://console.aws.amazon.com/efs/home?region=${region}#/file-systems/${encodeURIComponent(id)}`,
  'dynamodb-overprovisioned': ({ id, region }) =>
    `https://console.aws.amazon.com/dynamodbv2/home?region=${region}#table?name=${encodeURIComponent(id)}`,
  'elasticache-idle': ({ id, region }) =>
    `https://console.aws.amazon.com/elasticache/home?region=${region}#/redis/${encodeURIComponent(id)}`,
  'redshift-idle-cluster': ({ id, region }) =>
    `https://console.aws.amazon.com/redshiftv2/home?region=${region}#cluster-details?cluster=${encodeURIComponent(id)}`,
  'opensearch-idle-domain': ({ id, region }) =>
    `https://console.aws.amazon.com/aos/home?region=${region}#opensearch/domains/${encodeURIComponent(id)}`,
  'msk-idle-cluster': ({ region }) =>
    `https://console.aws.amazon.com/msk/home?region=${region}#/clusters`, // name-only id, no ARN on the entity — list view, not the exact cluster
  'fsx-idle-filesystem': ({ id, region }) =>
    `https://console.aws.amazon.com/fsx/home?region=${region}#file-system-details/${encodeURIComponent(id)}`,
  'documentdb-idle-instance': ({ id, region }) =>
    `https://console.aws.amazon.com/docdb/home?region=${region}#instance-details/${encodeURIComponent(id)}`,
  'neptune-idle-instance': ({ id, region }) =>
    `https://console.aws.amazon.com/neptune/home?region=${region}#instance-details/${encodeURIComponent(id)}`,
  'mq-idle-broker': ({ id, region }) =>
    `https://console.aws.amazon.com/amazon-mq/home?region=${region}#/brokers/${encodeURIComponent(id)}`,
  'workspaces-idle': ec2('workspaces', 'WorkspaceId'), // WorkSpaces console still lives under the same host pattern as EC2's
  'kinesis-provisioned-idle-stream': ({ id, region }) =>
    `https://console.aws.amazon.com/kinesis/home?region=${region}#/streams/details/${encodeURIComponent(id)}`,
  'sqs-dlq-abandoned': ({ id, region }) =>
    // id is already the full queue URL here (unlike every other kind).
    `https://console.aws.amazon.com/sqs/v3/home?region=${region}#/queues/${encodeURIComponent(id)}`,
  'sagemaker-notebook-idle': ({ id, region }) =>
    `https://console.aws.amazon.com/sagemaker/home?region=${region}#/notebook-instances/${encodeURIComponent(id)}`,
  'sagemaker-endpoint-idle': ({ id, region }) =>
    `https://console.aws.amazon.com/sagemaker/home?region=${region}#/endpoints/${encodeURIComponent(id)}`,
  'sagemaker-training-orphaned': ({ id, region }) =>
    `https://console.aws.amazon.com/sagemaker/home?region=${region}#/models/${encodeURIComponent(id)}`,
  'environment-ghost': undefined, // NO_LINK — synthetic tag-derived name, not a real resource
  'eks-node-overprovisioned': ({ id, region }) => {
    const [cluster, nodegroup] = id.split('/');
    return `https://console.aws.amazon.com/eks/home?region=${region}#/clusters/${encodeURIComponent(cluster)}/nodegroups/${encodeURIComponent(nodegroup)}`;
  },
  'eks-orphan-pvc': ec2('Volumes', 'volumeId'), // id is the backing EBS volume
  'ecr-image-untagged': undefined, // NO_LINK — id is an image digest, repo name isn't on the public interface
  'secretsmanager-unused': ({ id, region }) =>
    `https://console.aws.amazon.com/secretsmanager/secret?name=${encodeURIComponent(id)}&region=${region}`,
  'codepipeline-pipeline-stale': ({ id, region }) =>
    `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${encodeURIComponent(id)}/view?region=${region}`,

  // dead-resources
  'ec2-keypair-unused': undefined, // NO_LINK — id is the KeyPairId, not the key name the console needs
  'ec2-ri-expiring-soon': ec2('ReservedInstances', 'reservedInstancesId'),
  'iam-user-inactive': undefined, // NO_LINK — opaque IAM UserId, name not derivable
  'iam-policy-unattached': undefined, // NO_LINK — opaque IAM PolicyId, name not derivable
  'iam-role-unused': undefined, // NO_LINK — opaque IAM RoleId, name not derivable
  'iam-access-key-stale': undefined, // NO_LINK — access key ID alone, no console page without the username too
  'ec2-security-group-unused': vpc('SecurityGroups', 'groupId'),
  'logs-loggroup-empty': cloudwatchLogGroup(),
  'acm-certificate-unused': ({ id, region }) =>
    `https://console.aws.amazon.com/acm/home?region=${region}#/certificates/${encodeURIComponent(afterLastSlash(id))}`,
  'route53-hostedzone-empty': ({ id }) =>
    `https://console.aws.amazon.com/route53/v2/hostedzones#ListRecordSets/${encodeURIComponent(id)}`,
  'cloudformation-stack-stuck': directPath('cloudformation', '/stacks/stackinfo?stackId='),
  's3-bucket-empty': s3(),
  'cloudwatch-alarm-orphaned': cloudwatchAlarm(),
  'sns-topic-unsubscribed': directPath('sns/v3', '/topic/'),
  'iam-instance-profile-unattached': undefined, // NO_LINK — opaque IAM InstanceProfileId, name not derivable
  'eventbridge-rule-no-targets': ({ id, region }) =>
    // Default-event-bus rules only — a custom-bus rule ARN needs an extra
    // path segment this doesn't add; good enough for the common case.
    `https://console.aws.amazon.com/events/home?region=${region}#/rules/${encodeURIComponent(afterLastSlash(id))}`,
  'ecr-repository-empty': ({ id, region }) =>
    `https://console.aws.amazon.com/ecr/repositories/private/${encodeURIComponent(afterLastSlash(id))}?region=${region}`,
  'stepfunctions-statemachine-unused': directPath('states', '/statemachines/view/'),

  // resource-security
  'iam-root-mfa-disabled': () => 'https://console.aws.amazon.com/iam/home#/security_credentials',
  'iam-user-mfa-disabled': iamUserByArn(),
  'iam-access-key-rotation-overdue': undefined, // NO_LINK — access key ID alone, same gap as iam-access-key-stale
  'iam-root-access-key-active': () => 'https://console.aws.amazon.com/iam/home#/security_credentials',
  'iam-password-policy-weak': () => 'https://console.aws.amazon.com/iam/home#/account_settings',
  'ec2-security-group-open-ingress': vpc('SecurityGroups', 'groupId'),
  'ec2-default-security-group-permissive': vpc('SecurityGroups', 'groupId'),
  's3-bucket-public': s3(),
  'ec2-snapshot-public': ec2('Snapshots', 'snapshotId'),
  'ec2-volume-unencrypted': ec2('Volumes', 'volumeId'),
  'rds-instance-unencrypted': rds(false),
  's3-bucket-encryption-missing': s3(),
  'rds-instance-publicly-accessible': rds(false),
  'cloudtrail-not-multiregion': ({ region }) =>
    `https://console.aws.amazon.com/cloudtrailv2/home?region=${region ?? 'us-east-1'}#/trails`,
};

/**
 * Returns a direct AWS console URL for this finding, or `undefined` for the
 * handful of kinds where the data cloudrift has today can't be turned into a
 * working link (see the NO_LINK comments above) — never a guessed one.
 */
export function buildConsoleUrl(input: ConsoleLinkInput): string | undefined {
  const builder = BUILDERS[input.kind];
  return builder ? builder(input) : undefined;
}
