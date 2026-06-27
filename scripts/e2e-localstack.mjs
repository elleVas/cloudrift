// Third layer of the testing pyramid (see docs/en/testing.md): runs the
// actual built CLI binary end-to-end against a LocalStack container, on top
// of resources seeded by scripts/seed-localstack.mjs. Distinct from
// scripts/verify-against-aws.mjs (manual, real AWS, imports scanner classes
// directly) — this one is free, repeatable, and exercises the whole CLI
// (config loading, composition root, formatters, exit codes).
//
// Scope: 16 of 29 scanners (see docs/adr/0002-localstack-e2e-scope.md,
// docs/adr/0036-ec2-underutilized-excluded-from-localstack-e2e.md, and
// docs/adr/0039-cloudwatch-localstack-incompatibility.md for the Phase 5.5
// additions). Not wired into lint/test/build/typecheck — opt-in via:
//
//   pnpm nx run cli:e2e-localstack
//
// Requires Docker. Always tears the container down, even on failure.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { seedLocalstack } from './seed-localstack.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, '..');
const composeFile = resolve(workspaceRoot, 'docker-compose.localstack.yml');
const cliEntry = resolve(workspaceRoot, 'apps/cli/dist/main.js');

const REGION = 'us-east-1';
// Resources are created "now" by definition — without this, the default
// 7-day grace period in every WastePolicy would suppress every finding.
const MIN_AGE_DAYS = '0';

const EXPECTED_KINDS = [
  'ebs-volume',
  'elastic-ip',
  'load-balancer',
  'ec2-instance',
  'ebs-snapshot',
  'nat-gateway',
  'ebs-gp2-upgrade',
  'ebs-idle',
  'log-group',
  'eni-orphaned',
  's3-no-lifecycle',
  'lambda-underutilized',
  'dynamodb-overprovisioned',
  // Phase 5.5 (ADR-0038): 3 of the 4 always-on new scanners — fsx-idle-filesystem
  // is excluded entirely (LocalStack rejects FSx outright, same as RDS/EFS).
  // All 3 below are soft — see SOFT_KINDS and ADR-0039.
  'kinesis-provisioned-idle-stream',
  'vpn-connection-idle',
  'transit-gateway-idle-attachment',
];
// Historically partial LocalStack Community support — a missed finding here
// is a warning, not a hard failure (see docs/adr/0002-localstack-e2e-scope.md).
// kinesis/vpn/transit-gateway: resources are created correctly (confirmed via
// direct AWS CLI calls against the container) but GetMetricStatistics fails
// outright on LocalStack 4.0 for every CloudWatch-backed scanner, old and
// new alike — see docs/adr/0039-cloudwatch-localstack-incompatibility.md.
const SOFT_KINDS = new Set([
  'load-balancer',
  'nat-gateway',
  'kinesis-provisioned-idle-stream',
  'vpn-connection-idle',
  'transit-gateway-idle-attachment',
]);

function dockerCompose(...args) {
  const r = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited with code ${r.status}`);
  }
}

function runCli() {
  // Inherits process.env, which main() has already pointed at LocalStack.
  const result = spawnSync(
    process.execPath,
    [
      cliEntry,
      'analyze',
      '--regions',
      REGION,
      '--min-age-days',
      MIN_AGE_DAYS,
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`CLI exited with code ${result.status}`);
  }
  return result.stdout;
}

async function main() {
  if (!existsSync(cliEntry)) {
    console.error('Build the CLI before running this script:\n\n  pnpm nx run cli:build\n');
    process.exit(1);
  }

  const env = {
    AWS_ENDPOINT_URL: 'http://localhost:4566',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_DEFAULT_REGION: REGION,
    AWS_REGION: REGION,
  };
  Object.assign(process.env, env);

  console.log('Starting LocalStack...');
  dockerCompose('up', '-d', '--wait');

  try {
    console.log('Seeding resources...');
    const { seeded, skipped } = await seedLocalstack(REGION);
    console.log(`  seeded: ${seeded.join(', ')}`);
    if (skipped.length > 0) {
      console.log(`  skipped: ${skipped.map((s) => `${s.kind} (${s.reason})`).join(', ')}`);
    }

    console.log('\nRunning cloudrift analyze against LocalStack...');
    const stdout = runCli();
    const dto = JSON.parse(stdout);

    console.log();
    console.table(
      dto.breakdown.map((b) => ({
        kind: b.kind,
        label: b.label,
        category: b.category,
        count: b.count,
        monthlyCostUsd: b.monthlyCostUsd,
      })),
    );
    console.log(
      `Total waste: $${dto.totalWasteMonthlyUsd}/mo ($${dto.totalWasteAnnualUsd}/yr) across ${dto.wasteCount} findings; ` +
        `optimization opportunities: $${dto.totalOptimizationMonthlyUsd}/mo across ${dto.optimizationCount} findings.`,
    );

    const foundKinds = new Set(dto.findings.map((f) => f.kind));
    const missing = EXPECTED_KINDS.filter((kind) => !foundKinds.has(kind));
    const hardMissing = missing.filter((kind) => !SOFT_KINDS.has(kind));
    const softMissing = missing.filter((kind) => SOFT_KINDS.has(kind));

    if (softMissing.length > 0) {
      console.warn(
        `\nWarning: no finding for ${softMissing.join(', ')} — known partial LocalStack ` +
          'Community support, not failing the harness for this.',
      );
    }

    if (dto.scanErrors.length > 0) {
      console.warn(
        `\nWarning: scanErrors reported: ${dto.scanErrors.map((e) => `${e.kind}/${e.region}: ${e.message}`).join('; ')}`,
      );
    }

    if (hardMissing.length > 0) {
      throw new Error(`No finding produced for: ${hardMissing.join(', ')}`);
    }

    console.log(
      `\nOK: ${EXPECTED_KINDS.length - missing.length}/${EXPECTED_KINDS.length} expected kinds found` +
        (softMissing.length > 0 ? ` (${softMissing.length} soft-missing)` : ''),
    );
  } finally {
    console.log('\nTearing down LocalStack...');
    dockerCompose('down', '-v');
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
