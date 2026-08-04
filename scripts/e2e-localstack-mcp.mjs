// Same third layer of the testing pyramid as scripts/e2e-localstack.mjs
// (docs/en/testing.md), but through the `cloudrift mcp` stdio interface
// with a real MCP client instead of `cloudrift analyze --format json`.
// Reuses the same LocalStack container, seed data, and cloud-cost coverage
// expectations (EXPECTED_KINDS/SOFT_KINDS) as that script — this one adds
// the MCP-protocol layer on top: tools/list, then each of the seven tools
// through a real @modelcontextprotocol/sdk Client over StdioClientTransport.
//
// Not wired into lint/test/build/typecheck — opt-in via:
//
//   pnpm nx run cli:e2e-localstack-mcp
//
// Requires Docker. Always tears the container down, even on failure.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

import { seedLocalstack } from './seed-localstack.mjs';
import { REGION, EXPECTED_KINDS, SOFT_KINDS } from './e2e-localstack.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, '..');
const composeFile = resolve(workspaceRoot, 'docker-compose.localstack.yml');
const cliEntry = resolve(workspaceRoot, 'apps/cli/dist/main.js');

const MIN_AGE_DAYS = 0;
const EXPECTED_TOOLS = [
  'analyze_cloud_waste',
  'analyze_cloudrift',
  'analyze_dead_resources',
  'analyze_resource_security',
  'get_cost_trend',
  'get_required_iam_permissions',
  'get_resource_types',
];

function dockerCompose(...args) {
  const r = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited with code ${r.status}`);
  }
}

function toolText(result) {
  if (result.isError) {
    throw new Error(`tool call returned isError: ${result.content?.[0]?.text ?? '(no text)'}`);
  }
  return result.content[0].text;
}

async function main() {
  if (!existsSync(cliEntry)) {
    console.error('Build the CLI before running this script:\n\n  pnpm nx run cli:build\n');
    process.exit(1);
  }

  // Same LocalStack-facing env as e2e-localstack.mjs. Applied to
  // process.env too (seedLocalstack's AWS SDK clients read it from there),
  // but StdioClientTransport does NOT inherit the parent's full
  // environment by default — real MCP clients (Claude Desktop, Kiro, VS
  // Code) don't either, they only pass a curated safe subset
  // (getDefaultEnvironment()) unless the client config's `env` says
  // otherwise. Passing it explicitly below is not a test-only workaround:
  // it is the same thing a real "env" block in an MCP client config would
  // need to do to point cloudrift at anything other than the default AWS
  // credential chain — see docs/en/usage.md's mcp section.
  const localstackEnv = {
    AWS_ENDPOINT_URL: 'http://localhost:4566',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_DEFAULT_REGION: REGION,
    AWS_REGION: REGION,
    CLOUDRIFT_SCAN_CONCURRENCY: process.env.CLOUDRIFT_SCAN_CONCURRENCY || '1',
  };
  Object.assign(process.env, localstackEnv);

  console.log('Starting LocalStack...');
  dockerCompose('up', '-d', '--wait');

  let client;
  try {
    console.log('Seeding resources...');
    const { seeded, skipped } = await seedLocalstack(REGION);
    console.log(`  seeded: ${seeded.join(', ')}`);
    if (skipped.length > 0) {
      console.log(`  skipped: ${skipped.map((s) => `${s.kind} (${s.reason})`).join(', ')}`);
    }

    console.log('\nConnecting to "cloudrift mcp" over stdio...');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliEntry, 'mcp'],
      env: { ...getDefaultEnvironment(), ...localstackEnv },
    });
    client = new Client({ name: 'cloudrift-e2e', version: '0.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    if (toolNames.join(',') !== EXPECTED_TOOLS.join(',')) {
      throw new Error(`tools/list returned [${toolNames.join(', ')}], expected [${EXPECTED_TOOLS.join(', ')}]`);
    }
    console.log(`OK: tools/list returned exactly ${EXPECTED_TOOLS.join(', ')}`);

    const resourceTypes = JSON.parse(toolText(await client.callTool({ name: 'get_resource_types', arguments: {} })));
    if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
      throw new Error('get_resource_types returned an empty/invalid catalog');
    }
    console.log(`OK: get_resource_types returned ${resourceTypes.length} entries, no AWS call needed`);

    const iamPolicy = JSON.parse(
      toolText(await client.callTool({ name: 'get_required_iam_permissions', arguments: {} })),
    );
    if (!iamPolicy.Statement?.[0]?.Action?.includes('sts:GetCallerIdentity')) {
      throw new Error('get_required_iam_permissions: policy missing sts:GetCallerIdentity');
    }
    console.log(`OK: get_required_iam_permissions returned ${iamPolicy.Statement[0].Action.length} actions, no AWS call needed`);

    // Same LocalStack Community limitation as analyze_cloudrift's costTrend
    // branch below: Cost Explorer isn't emulated, so isError here is the
    // expected outcome, not a failure of this tool.
    console.log('\nCalling get_cost_trend against LocalStack (Cost Explorer is not emulated by LocalStack Community)...');
    const costTrendResult = await client.callTool({ name: 'get_cost_trend', arguments: { months: 1 } });
    if (costTrendResult.isError) {
      console.log(`OK: get_cost_trend failed gracefully as expected: ${costTrendResult.content[0].text}`);
    } else {
      const costTrend = JSON.parse(toolText(costTrendResult));
      if (!Array.isArray(costTrend.months)) throw new Error('get_cost_trend: response missing months[]');
      console.log('OK: get_cost_trend succeeded (unexpected against LocalStack Community, but not a failure)');
    }

    console.log('\nCalling analyze_cloud_waste against LocalStack (this is the real, credentialed call)...');
    const cloudWaste = JSON.parse(
      toolText(
        await client.callTool({
          name: 'analyze_cloud_waste',
          arguments: { regions: [REGION], minAgeDays: MIN_AGE_DAYS },
        }),
      ),
    );
    const cloudWasteFoundKinds = new Set(cloudWaste.findings.map((f) => f.kind));
    const cloudWasteMissing = EXPECTED_KINDS.filter((kind) => !cloudWasteFoundKinds.has(kind));
    const cloudWasteHardMissing = cloudWasteMissing.filter((kind) => !SOFT_KINDS.has(kind));
    if (cloudWasteHardMissing.length > 0) {
      console.error('cloudWaste.scanErrors:', JSON.stringify(cloudWaste.scanErrors, null, 2));
      throw new Error(`analyze_cloud_waste: no finding for ${cloudWasteHardMissing.join(', ')}`);
    }
    console.log(
      `OK: analyze_cloud_waste found ${EXPECTED_KINDS.length - cloudWasteMissing.length}/${EXPECTED_KINDS.length} expected kinds` +
        (cloudWasteMissing.length > 0 ? ` (${cloudWasteMissing.length} soft-missing: ${cloudWasteMissing.join(', ')})` : ''),
    );

    // No fixtures are seeded for these two domains (seed-localstack.mjs is
    // cloud-cost-only) — just assert the call completes without isError.
    // Zero findings here is expected, not a failure.
    console.log('\nCalling analyze_dead_resources and analyze_resource_security against LocalStack...');
    const deadResources = JSON.parse(
      toolText(await client.callTool({ name: 'analyze_dead_resources', arguments: { regions: [REGION], minAgeDays: MIN_AGE_DAYS } })),
    );
    const resourceSecurity = JSON.parse(
      toolText(await client.callTool({ name: 'analyze_resource_security', arguments: { regions: [REGION] } })),
    );
    if (!Array.isArray(deadResources.findings)) throw new Error('analyze_dead_resources: response missing findings[]');
    if (!Array.isArray(resourceSecurity.findings)) throw new Error('analyze_resource_security: response missing findings[]');
    console.log('OK: analyze_dead_resources and analyze_resource_security both completed (no fixtures seeded, findings incidental)');

    console.log('\nCalling analyze_cloudrift against LocalStack (this is the real, credentialed call)...');
    const report = JSON.parse(
      toolText(
        await client.callTool({
          name: 'analyze_cloudrift',
          arguments: { regions: [REGION], minAgeDays: MIN_AGE_DAYS },
        }),
      ),
    );

    if (!report.cloudWaste) throw new Error('analyze_cloudrift: cloudWaste domain missing from the report');
    const foundKinds = new Set(report.cloudWaste.findings.map((f) => f.kind));
    const missing = EXPECTED_KINDS.filter((kind) => !foundKinds.has(kind));
    const hardMissing = missing.filter((kind) => !SOFT_KINDS.has(kind));
    if (hardMissing.length > 0) {
      console.error('cloudWaste.scanErrors:', JSON.stringify(report.cloudWaste.scanErrors, null, 2));
      console.error('domainErrors:', JSON.stringify(report.domainErrors, null, 2));
      throw new Error(`analyze_cloudrift.cloudWaste: no finding for ${hardMissing.join(', ')}`);
    }
    console.log(
      `OK: analyze_cloudrift.cloudWaste found ${EXPECTED_KINDS.length - missing.length}/${EXPECTED_KINDS.length} expected kinds` +
        (missing.length > 0 ? ` (${missing.length} soft-missing: ${missing.join(', ')})` : ''),
    );

    // No fixtures are seeded for these two domains (seed-localstack.mjs is
    // cloud-cost-only) — just assert they ran to completion without erroring.
    // Zero findings here is expected, not a failure.
    if (!report.deadResources) throw new Error('analyze_cloudrift: deadResources domain missing (see domainErrors)');
    if (!report.resourceSecurity) throw new Error('analyze_cloudrift: resourceSecurity domain missing (see domainErrors)');
    console.log('OK: deadResources and resourceSecurity domains both completed (no fixtures seeded, findings incidental)');

    // AWS Cost Explorer is a real, billed API that LocalStack Community does
    // not emulate — costTrend failing gracefully into domainErrors (instead
    // of crashing the whole call) is the expected, correct outcome here.
    const costTrendError = report.domainErrors.find((e) => e.domain === 'costTrend');
    if (report.costTrend) {
      console.log('OK: costTrend succeeded (unexpected against LocalStack Community, but not a failure)');
    } else if (costTrendError) {
      console.log(`OK: costTrend failed gracefully into domainErrors as expected: ${costTrendError.message}`);
    } else {
      throw new Error('analyze_cloudrift: costTrend is neither present nor in domainErrors');
    }

    console.log('\nAll MCP smoke checks passed.');
  } finally {
    await client?.close();
    console.log('\nTearing down LocalStack...');
    dockerCompose('down', '-v');
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
