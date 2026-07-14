// Captures contract-test fixtures (REVIEW.md #10) from LocalStack: boots the
// container, seeds it with scripts/seed-localstack.mjs, then runs each
// LocalStack-coverable scanner with a recorder patched onto the AWS SDK's
// shared Client base class. Every raw response (and thrown SDK error) each
// scanner sees is written — page by page, keyed by Command name — to
// libs/cloud-cost/infrastructure/aws-adapter/src/testing/contract-fixtures/<kind>.json,
// together with the findings the live run produced. scanner-contract.spec.ts
// replays those pages offline and must reproduce the same findings.
//
// The 13 kinds LocalStack Community can't host (FSx/RDS/EFS and the 10
// --live-pricing-gated ones) have hand-transcribed fixtures in the same
// directory (marked "source": "transcribed"); this script never overwrites
// them.
//
// Not wired into lint/test/build — run manually to (re)generate fixtures:
//
//   pnpm nx run-many -t build && node scripts/capture-contract-fixtures.mjs
//
// Requires Docker. Always tears the container down, even on failure.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { seedLocalstack } from './seed-localstack.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, '..');
const composeFile = resolve(workspaceRoot, 'docker-compose.localstack.yml');
const fixturesDir = resolve(
  workspaceRoot,
  'libs/cloud-cost/infrastructure/aws-adapter/src/testing/contract-fixtures',
);

const REGION = 'us-east-1';
const ACCOUNT_ID = '000000000000';

const requiredDistDirs = [
  resolve(workspaceRoot, 'libs/cloud-cost/domain/dist'),
  resolve(workspaceRoot, 'libs/cloud-cost/infrastructure/aws-adapter/dist'),
];
const missingDist = requiredDistDirs.filter((dir) => !existsSync(dir));
if (missingDist.length > 0) {
  console.error('Build the workspace before running this script:\n\n  pnpm nx run-many -t build\n');
  process.exit(1);
}

function dockerCompose(...args) {
  const r = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited with code ${r.status}`);
  }
}

Object.assign(process.env, {
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_DEFAULT_REGION: REGION,
  AWS_REGION: REGION,
});

const adapter = await import('cloud-cost-infrastructure-aws-adapter');
const domain = await import('cloud-cost-domain');
const { EC2Client } = await import('@aws-sdk/client-ec2');

const region = domain.AwsRegion.create(REGION);
const pricing = new adapter.StaticPriceTableAdapter();
// Seeded resources are created "now": without minAgeDays 0 every policy's
// grace period would suppress every finding (same reason the e2e harness
// passes --min-age-days 0).
const po = { minAgeDays: 0 };

// Mirrors the always-on entries of apps/cli scanner-registry.ts for the kinds
// the LocalStack seed covers (fsx-idle-filesystem excluded: LocalStack rejects
// FSx outright; rds-instance/efs-unused rejected the same way; the
// --live-pricing scanners can't run here at all — the Pricing API is a real
// signed endpoint).
// Deliberately not captured, transcribed by hand instead:
// - ebs-snapshot: moto pre-seeds LocalStack with >1000 canned public
//   snapshots owned by the default account — the captured fixture came out
//   at 616K with 1160 findings, and the hand-written one exercises the
//   AMI-bound/volume-still-exists exclusion branches deliberately.
// - load-balancer: elbv2 is not in the LocalStack Community license.
const captures = [
  { kind: 'ebs-volume', scanner: new adapter.AwsEbsVolumeScanner(pricing, ACCOUNT_ID, new domain.EbsVolumeWastePolicy(po)) },
  { kind: 'elastic-ip', scanner: new adapter.AwsElasticIpScanner(pricing, ACCOUNT_ID, new domain.ElasticIpWastePolicy(po)) },
  { kind: 'ec2-instance', scanner: new adapter.AwsEc2InstanceScanner(pricing, ACCOUNT_ID, new domain.Ec2InstanceWastePolicy(po)) },
  { kind: 'nat-gateway', scanner: new adapter.AwsNatGatewayScanner(pricing, ACCOUNT_ID, new domain.NatGatewayWastePolicy(po)) },
  { kind: 'ebs-gp2-upgrade', scanner: new adapter.AwsGp2UpgradeScanner(pricing, ACCOUNT_ID, new domain.Gp2UpgradePolicy(po)) },
  { kind: 'ebs-idle', scanner: new adapter.AwsEbsIdleScanner(pricing, ACCOUNT_ID, new domain.EbsIdlePolicy(po, 0)) },
  { kind: 'log-group', scanner: new adapter.AwsLogGroupScanner(pricing, ACCOUNT_ID, new domain.LogGroupWastePolicy(po)) },
  { kind: 'eni-orphaned', scanner: new adapter.AwsEniOrphanedScanner(ACCOUNT_ID, new domain.OrphanedEniWastePolicy(po)) },
  { kind: 's3-no-lifecycle', scanner: new adapter.AwsS3NoLifecycleScanner(pricing, ACCOUNT_ID, new domain.S3NoLifecyclePolicy(po)) },
  { kind: 'lambda-underutilized', scanner: new adapter.AwsLambdaUnderutilizedScanner(ACCOUNT_ID, new domain.LambdaUnderutilizedPolicy(po, 0)) },
  { kind: 'dynamodb-overprovisioned', scanner: new adapter.AwsDynamoDbOverprovisionedScanner(pricing, ACCOUNT_ID, new domain.DynamoDbOverprovisionedPolicy(po, 10)) },
  { kind: 'kinesis-provisioned-idle-stream', scanner: new adapter.AwsKinesisIdleScanner(pricing, ACCOUNT_ID, new domain.KinesisProvisionedIdleStreamPolicy(po)) },
  { kind: 'vpn-connection-idle', scanner: new adapter.AwsVpnConnectionIdleScanner(pricing, ACCOUNT_ID, new domain.VpnConnectionIdlePolicy(po)) },
  { kind: 'transit-gateway-idle-attachment', scanner: new adapter.AwsTransitGatewayIdleScanner(pricing, ACCOUNT_ID, new domain.TransitGatewayIdleAttachmentPolicy(po)) },
  { kind: 'lambda-loggroup-orphaned', scanner: new adapter.AwsLambdaLogGroupOrphanedScanner(pricing, ACCOUNT_ID, new domain.LambdaLogGroupOrphanedPolicy(po)) },
];

// Recorder on the shared SDK Client base class (every @aws-sdk/client-*
// class extends the same instance — verified: Object.getPrototypeOf(EC2Client)
// === Object.getPrototypeOf(CloudWatchClient)). null = not recording (the
// seeding phase must not be captured).
let recording = null;
const clientBase = Object.getPrototypeOf(EC2Client);
const originalSend = clientBase.prototype.send;
clientBase.prototype.send = async function (command, ...rest) {
  const name = command.constructor.name;
  try {
    const output = await originalSend.call(this, command, ...rest);
    if (recording) (recording[name] ??= []).push(output);
    return output;
  } catch (err) {
    if (recording) {
      (recording[name] ??= []).push({ $error: { name: err.name, message: err.message } });
    }
    throw err;
  }
};

async function main() {
  console.log('Starting LocalStack...');
  dockerCompose('up', '-d', '--wait');

  try {
    console.log('Seeding resources...');
    const { seeded, skipped } = await seedLocalstack(REGION);
    console.log(`  seeded: ${seeded.join(', ')}`);
    if (skipped.length > 0) {
      console.log(`  skipped: ${skipped.map((s) => `${s.kind} (${s.reason})`).join(', ')}`);
    }

    mkdirSync(fixturesDir, { recursive: true });
    const written = [];
    const missed = [];

    for (const { kind, scanner } of captures) {
      recording = {};
      const result = await scanner.scan(region);
      const pages = recording;
      recording = null;

      if (!result.ok) {
        missed.push({ kind, reason: result.error.message });
        continue;
      }
      if (result.value.length === 0) {
        missed.push({ kind, reason: 'scan produced no findings (nothing to assert on replay)' });
        continue;
      }

      const fixture = {
        kind,
        source: `localstack capture, ${new Date().toISOString().slice(0, 10)}, scripts/capture-contract-fixtures.mjs`,
        region: REGION,
        accountId: ACCOUNT_ID,
        pages,
        expected: {
          findings: result.value.map((f) => ({
            id: f.id,
            monthlyCostUsd: f.costEstimate.monthlyCostUsd,
          })),
        },
      };
      writeFileSync(resolve(fixturesDir, `${kind}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
      written.push(`${kind} (${result.value.length} findings)`);
    }

    console.log(`\nFixtures written to ${fixturesDir}:`);
    for (const w of written) console.log(`  - ${w}`);
    if (missed.length > 0) {
      console.warn('\nNo fixture captured for:');
      for (const m of missed) console.warn(`  - ${m.kind}: ${m.reason}`);
    }
  } finally {
    console.log('\nTearing down LocalStack...');
    dockerCompose('down', '-v');
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
