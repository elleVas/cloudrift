// Creates the minimal AWS resources needed to trigger each of the 13
// LocalStack-coverable waste findings (see docs/adr/0002-localstack-e2e-scope.md
// and docs/adr/0036-ec2-underutilized-excluded-from-localstack-e2e.md for the
// scope and why rds-instance/rds-underutilized/elasticache-idle/efs-unused/
// ec2-underutilized are NOT here).
//
// CloudWatch-backed scanners (nat-gateway, ebs-idle, lambda-underutilized,
// dynamodb-overprovisioned) need no explicit metric seeding: every scanner
// treats a missing datapoint as zero usage (`Datapoints?.[0]?.Sum ?? 0`), and
// LocalStack's CloudWatch GetMetricStatistics simply returns no datapoints
// for metrics nobody ever pushed — which is already "idle" by definition.
//
// Only called by scripts/e2e-localstack.mjs; not a standalone CI/test target.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EC2Client } from '@aws-sdk/client-ec2';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import {
  CreateVpcCommand,
  CreateSubnetCommand,
  CreateVolumeCommand,
  AttachVolumeCommand,
  CreateSnapshotCommand,
  DeleteVolumeCommand,
  RunInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
  AllocateAddressCommand,
  CreateNatGatewayCommand,
  CreateNetworkInterfaceCommand,
} from '@aws-sdk/client-ec2';
import {
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { CreateFunctionCommand } from '@aws-sdk/client-lambda';
import { CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { CreateLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs';

const AZ_A = 'us-east-1a';
const AZ_B = 'us-east-1b';
// LocalStack's moto-based EC2 mock accepts any ami-* shaped id without
// validating it against a real AMI catalog.
const FAKE_AMI_ID = 'ami-0123456789abcdef0';
const FAKE_LAMBDA_ROLE_ARN = 'arn:aws:iam::000000000000:role/cloudrift-e2e-lambda-role';

function buildLambdaZip() {
  const dir = mkdtempSync(join(tmpdir(), 'cloudrift-lambda-'));
  const indexPath = join(dir, 'index.js');
  writeFileSync(indexPath, 'exports.handler = async () => ({ statusCode: 200 });\n');
  const zipPath = join(dir, 'function.zip');
  execFileSync('zip', ['-j', zipPath, indexPath]);
  return readFileSync(zipPath);
}

async function waitForInstanceState(ec2, instanceId, state) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const current = r.Reservations?.[0]?.Instances?.[0]?.State?.Name;
    if (current === state) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Instance ${instanceId} never reached state "${state}"`);
}

/**
 * Seeds one wasted/optimizable resource per kind. Returns which kinds were
 * seeded successfully vs skipped (with a reason) — load-balancer and
 * nat-gateway have historically had partial LocalStack Community support, so
 * a failure there is logged and skipped rather than aborting the whole seed.
 */
export async function seedLocalstack(regionCode) {
  const seeded = [];
  const skipped = [];

  const ec2 = new EC2Client({ region: regionCode });
  const elbv2 = new ElasticLoadBalancingV2Client({ region: regionCode });
  const s3 = new S3Client({ region: regionCode, forcePathStyle: true });
  const lambda = new LambdaClient({ region: regionCode });
  const dynamodb = new DynamoDBClient({ region: regionCode });
  const logs = new CloudWatchLogsClient({ region: regionCode });

  async function seed(kind, fn) {
    try {
      await fn();
      seeded.push(kind);
    } catch (err) {
      skipped.push({ kind, reason: err.message });
      console.warn(`  [seed] skipping ${kind}: ${err.message}`);
    }
  }

  // Shared networking: one VPC + two subnets (different AZs, some AWS APIs
  // such as CreateLoadBalancer want more than one) used by load-balancer,
  // nat-gateway and eni-orphaned.
  let subnetIdA;
  let subnetIdB;
  try {
    const vpc = await ec2.send(new CreateVpcCommand({ CidrBlock: '10.0.0.0/16' }));
    const vpcId = vpc.Vpc.VpcId;
    const subA = await ec2.send(
      new CreateSubnetCommand({ VpcId: vpcId, CidrBlock: '10.0.1.0/24', AvailabilityZone: AZ_A }),
    );
    const subB = await ec2.send(
      new CreateSubnetCommand({ VpcId: vpcId, CidrBlock: '10.0.2.0/24', AvailabilityZone: AZ_B }),
    );
    subnetIdA = subA.Subnet.SubnetId;
    subnetIdB = subB.Subnet.SubnetId;
  } catch (err) {
    console.warn(`  [seed] could not set up shared VPC/subnets: ${err.message}`);
  }

  // A running instance to attach the gp2/idle volumes to (ec2-instance waste
  // needs a *stopped* instance, so this one is separate and stays running).
  let attachmentInstanceId;
  await seed('ebs-gp2-upgrade', async () => {
    const run = await ec2.send(
      new RunInstancesCommand({
        ImageId: FAKE_AMI_ID,
        InstanceType: 't3.micro',
        MinCount: 1,
        MaxCount: 1,
      }),
    );
    attachmentInstanceId = run.Instances[0].InstanceId;
    await waitForInstanceState(ec2, attachmentInstanceId, 'running');

    const vol = await ec2.send(
      new CreateVolumeCommand({ AvailabilityZone: AZ_A, Size: 8, VolumeType: 'gp2' }),
    );
    await ec2.send(
      new AttachVolumeCommand({
        VolumeId: vol.VolumeId,
        InstanceId: attachmentInstanceId,
        Device: '/dev/sdf',
      }),
    );
  });

  await seed('ebs-idle', async () => {
    if (!attachmentInstanceId) throw new Error('no running instance to attach to');
    const vol = await ec2.send(
      new CreateVolumeCommand({ AvailabilityZone: AZ_A, Size: 8, VolumeType: 'gp3' }),
    );
    await ec2.send(
      new AttachVolumeCommand({
        VolumeId: vol.VolumeId,
        InstanceId: attachmentInstanceId,
        Device: '/dev/sdg',
      }),
    );
  });

  await seed('ebs-volume', async () => {
    await ec2.send(new CreateVolumeCommand({ AvailabilityZone: AZ_A, Size: 4 }));
  });

  await seed('ebs-snapshot', async () => {
    const vol = await ec2.send(new CreateVolumeCommand({ AvailabilityZone: AZ_A, Size: 4 }));
    await ec2.send(new CreateSnapshotCommand({ VolumeId: vol.VolumeId }));
    await ec2.send(new DeleteVolumeCommand({ VolumeId: vol.VolumeId }));
  });

  await seed('ec2-instance', async () => {
    const run = await ec2.send(
      new RunInstancesCommand({
        ImageId: FAKE_AMI_ID,
        InstanceType: 't3.micro',
        MinCount: 1,
        MaxCount: 1,
      }),
    );
    const instanceId = run.Instances[0].InstanceId;
    await waitForInstanceState(ec2, instanceId, 'running');
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
    await waitForInstanceState(ec2, instanceId, 'stopped');
  });

  await seed('elastic-ip', async () => {
    await ec2.send(new AllocateAddressCommand({ Domain: 'vpc' }));
  });

  await seed('eni-orphaned', async () => {
    if (!subnetIdA) throw new Error('no subnet available');
    await ec2.send(new CreateNetworkInterfaceCommand({ SubnetId: subnetIdA }));
  });

  await seed('nat-gateway', async () => {
    if (!subnetIdA) throw new Error('no subnet available');
    const eip = await ec2.send(new AllocateAddressCommand({ Domain: 'vpc' }));
    await ec2.send(
      new CreateNatGatewayCommand({ SubnetId: subnetIdA, AllocationId: eip.AllocationId }),
    );
  });

  await seed('load-balancer', async () => {
    if (!subnetIdA || !subnetIdB) throw new Error('no subnets available');
    const lb = await elbv2.send(
      new CreateLoadBalancerCommand({
        Name: `cloudrift-e2e-${Date.now()}`,
        Subnets: [subnetIdA, subnetIdB],
        Type: 'application',
      }),
    );
    const vpcId = lb.LoadBalancers[0].VpcId;
    await elbv2.send(
      new CreateTargetGroupCommand({
        Name: `cloudrift-e2e-tg-${Date.now()}`,
        Protocol: 'HTTP',
        Port: 80,
        VpcId: vpcId,
        TargetType: 'instance',
      }),
    );
    // No RegisterTargets call — zero registered targets is the waste condition.
  });

  await seed('log-group', async () => {
    await logs.send(new CreateLogGroupCommand({ logGroupName: `/cloudrift-e2e/${Date.now()}` }));
    // No PutRetentionPolicy call — missing retention is the waste condition.
  });

  await seed('s3-no-lifecycle', async () => {
    await s3.send(new CreateBucketCommand({ Bucket: `cloudrift-e2e-${Date.now()}` }));
    // No PutBucketLifecycleConfiguration call — that's the finding.
    void PutBucketLifecycleConfigurationCommand; // kept imported for documentation of the call we intentionally skip
  });

  await seed('lambda-underutilized', async () => {
    const zip = buildLambdaZip();
    await lambda.send(
      new CreateFunctionCommand({
        FunctionName: `cloudrift-e2e-${Date.now()}`,
        Runtime: 'nodejs18.x',
        Role: FAKE_LAMBDA_ROLE_ARN,
        Handler: 'index.handler',
        Code: { ZipFile: zip },
      }),
    );
    // No invocations — zero CloudWatch Invocations datapoints is the waste condition.
  });

  await seed('dynamodb-overprovisioned', async () => {
    await dynamodb.send(
      new CreateTableCommand({
        TableName: `cloudrift-e2e-${Date.now()}`,
        BillingMode: 'PROVISIONED',
        ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      }),
    );
    // Zero consumption against a provisioned table is the waste condition.
  });

  for (const client of [ec2, elbv2, s3, lambda, dynamodb, logs]) client.destroy();

  return { seeded, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const region = process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  const { seeded, skipped } = await seedLocalstack(region);
  console.log(`Seeded: ${seeded.join(', ')}`);
  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.map((s) => `${s.kind} (${s.reason})`).join(', ')}`);
  }
}
