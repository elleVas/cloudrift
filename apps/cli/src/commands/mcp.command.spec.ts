// SPDX-License-Identifier: Apache-2.0
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Result } from 'shared-kernel';
import { buildMcpServer, isDisabledByEnv, mcpCommand } from './mcp.command';
import type { McpDeps, AggregateAnalysisReportDto } from './mcp.composition';

const meta = { accountId: '123456789012', regions: ['us-east-1'], generatedAt: '2026-06-12T10:00:00.000Z' };
const contact = { email: 'security@cloudrift.dev', linkedin: 'https://linkedin.com/company/cloudrift' };
const costTrendDto = {
  meta: { accountId: meta.accountId, generatedAt: meta.generatedAt },
  disclaimer: 'disclaimer',
  contact,
  months: [{ month: '2026-06', totalUsd: 42.5, final: false }],
};

// Fully-shaped fixture (not a loose stub): this is the real DTO contract
// `mcp.composition.ts` produces — `toWasteReportDto`/`toDeadResourceReportDto`/
// `toResourceSecurityReportDto`/`toCostTrendDto` are unit-tested separately
// (their own `*.dto.spec.ts`) against real domain entities; this spec only
// exercises `mcp.command.ts`'s pass-through/error-mapping, not the DTO shape.
const emptyReport: AggregateAnalysisReportDto = {
  cloudWaste: {
    meta: { ...meta, pricesAsOf: '2026-06' },
    disclaimer: 'disclaimer',
    contact,
    totalWasteMonthlyUsd: 0,
    totalWasteAnnualUsd: 0,
    totalOptimizationMonthlyUsd: 0,
    wasteCount: 0,
    optimizationCount: 0,
    breakdown: [],
    findings: [],
    scanErrors: [],
  },
  deadResources: { meta, disclaimer: 'disclaimer', countBySeverity: { info: 0, warning: 0, critical: 0 }, findings: [], scanErrors: [] },
  resourceSecurity: { meta, disclaimer: 'disclaimer', countBySeverity: { info: 0, warning: 0, critical: 0 }, findings: [], scanErrors: [] },
  costTrend: { meta: { accountId: meta.accountId, generatedAt: meta.generatedAt }, disclaimer: 'disclaimer', contact, months: [] },
  domainErrors: [],
};

// Every test only cares about one tool's deps method at a time — this gives
// each a working no-op for the other four instead of repeating all five at
// every call site.
const baseDeps: McpDeps = {
  runAggregateAnalysis: async () => Result.ok(emptyReport),
  runCostTrend: async () => Result.ok(costTrendDto),
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  runCloudWaste: async () => Result.ok(emptyReport.cloudWaste!),
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  runDeadResources: async () => Result.ok(emptyReport.deadResources!),
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  runResourceSecurity: async () => Result.ok(emptyReport.resourceSecurity!),
};

async function connectedClient(deps: Partial<McpDeps> = {}): Promise<Client> {
  const server = buildMcpServer({ ...baseDeps, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('cloudrift mcp server', () => {
  it('registers exactly the seven planned tools', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'analyze_cloud_waste',
      'analyze_cloudrift',
      'analyze_dead_resources',
      'analyze_resource_security',
      'get_cost_trend',
      'get_required_iam_permissions',
      'get_resource_types',
    ]);
  });

  it('analyze_cloudrift returns the aggregated report as JSON text', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'analyze_cloudrift', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(emptyReport);
  });

  it('analyze_cloudrift passes a partial domainErrors entry through as-is (already {domain, message})', async () => {
    // The Error→message flattening itself happens in mcp.composition.ts
    // (defaultRunAggregateAnalysis), not here — mcp.command.ts's handler is
    // a pure pass-through of whatever McpDeps.runAggregateAnalysis returns.
    const partialReport: AggregateAnalysisReportDto = {
      ...emptyReport,
      costTrend: undefined,
      domainErrors: [{ domain: 'costTrend', message: 'Cost Explorer unavailable' }],
    };
    const client = await connectedClient({ runAggregateAnalysis: async () => Result.ok(partialReport) });
    const result = await client.callTool({ name: 'analyze_cloudrift', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.domainErrors).toEqual([{ domain: 'costTrend', message: 'Cost Explorer unavailable' }]);
    expect(parsed.costTrend).toBeUndefined();
  });

  it('analyze_cloudrift surfaces a domain-level failure as isError instead of throwing', async () => {
    const client = await connectedClient({ runAggregateAnalysis: async () => Result.fail(new Error('STS unavailable')) });
    const result = await client.callTool({ name: 'analyze_cloudrift', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('STS unavailable');
  });

  it('analyze_cloudrift surfaces a thrown (not rejected-Result) error as isError instead of crashing the server', async () => {
    const client = await connectedClient({
      runAggregateAnalysis: async () => {
        throw new Error('unexpected composition failure');
      },
    });
    const result = await client.callTool({ name: 'analyze_cloudrift', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('unexpected composition failure');
  });

  it('analyze_cloudrift surfaces a thrown non-Error value as isError with a string message', async () => {
    const client = await connectedClient({
      runAggregateAnalysis: async () => {
        throw 'a string thrown for some reason';
      },
    });
    const result = await client.callTool({ name: 'analyze_cloudrift', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('a string thrown for some reason');
  });

  it('analyze_cloud_waste returns the cloud-waste report as JSON text', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'analyze_cloud_waste', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(emptyReport.cloudWaste);
  });

  it('analyze_cloud_waste surfaces a Result.fail as isError instead of throwing', async () => {
    const client = await connectedClient({ runCloudWaste: async () => Result.fail(new Error('STS unavailable')) });
    const result = await client.callTool({ name: 'analyze_cloud_waste', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('STS unavailable');
  });

  it('analyze_dead_resources returns the dead-resources report as JSON text', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'analyze_dead_resources', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(emptyReport.deadResources);
  });

  it('analyze_dead_resources surfaces a Result.fail as isError instead of throwing', async () => {
    const client = await connectedClient({ runDeadResources: async () => Result.fail(new Error('STS unavailable')) });
    const result = await client.callTool({ name: 'analyze_dead_resources', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('STS unavailable');
  });

  it('analyze_resource_security returns the resource-security report as JSON text', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'analyze_resource_security', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(emptyReport.resourceSecurity);
  });

  it('analyze_resource_security surfaces a Result.fail as isError instead of throwing', async () => {
    const client = await connectedClient({ runResourceSecurity: async () => Result.fail(new Error('STS unavailable')) });
    const result = await client.callTool({ name: 'analyze_resource_security', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('STS unavailable');
  });

  it('get_cost_trend returns the cost trend as JSON text', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'get_cost_trend', arguments: { months: 3 } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(costTrendDto);
  });

  it('get_cost_trend surfaces a Result.fail as isError instead of throwing', async () => {
    const client = await connectedClient({ runCostTrend: async () => Result.fail(new Error('Cost Explorer unavailable')) });
    const result = await client.callTool({ name: 'get_cost_trend', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Cost Explorer unavailable');
  });

  it('get_resource_types lists kinds from all three scanned domains, no AWS call', async () => {
    const runAggregateAnalysis = jest.fn();
    const client = await connectedClient({ runAggregateAnalysis });
    const result = await client.callTool({ name: 'get_resource_types', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const catalog = JSON.parse(content[0].text) as Array<{ domain: string; kind: string }>;
    expect(catalog.length).toBeGreaterThan(0);
    expect(new Set(catalog.map((c) => c.domain))).toEqual(
      new Set(['cloudWaste', 'deadResources', 'resourceSecurity']),
    );
    expect(runAggregateAnalysis).not.toHaveBeenCalled();
  });

  it('get_required_iam_permissions returns a policy document, no AWS call', async () => {
    const runAggregateAnalysis = jest.fn();
    const client = await connectedClient({ runAggregateAnalysis });
    const result = await client.callTool({ name: 'get_required_iam_permissions', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const policy = JSON.parse(content[0].text);
    expect(policy.Statement[0].Action).toEqual(expect.arrayContaining(['sts:GetCallerIdentity', 'ce:GetCostAndUsage']));
    expect(runAggregateAnalysis).not.toHaveBeenCalled();
  });
});

describe('CLOUDRIFT_DISABLE_MCP kill switch', () => {
  const originalEnv = process.env.CLOUDRIFT_DISABLE_MCP;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLOUDRIFT_DISABLE_MCP;
    else process.env.CLOUDRIFT_DISABLE_MCP = originalEnv;
    process.exitCode = undefined;
  });

  it.each(['1', 'true', 'TRUE'])('refuses to start when set to %s, before touching AWS', async (value) => {
    process.env.CLOUDRIFT_DISABLE_MCP = value;
    const runAggregateAnalysis = jest.fn();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await mcpCommand({ ...baseDeps, runAggregateAnalysis });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CLOUDRIFT_DISABLE_MCP'));
    expect(runAggregateAnalysis).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each(['0', 'false', 'yes', ''])('leaves it enabled for value %s', (value) => {
    process.env.CLOUDRIFT_DISABLE_MCP = value;
    // Asserts the guard directly rather than through mcpCommand(): a real
    // (non-disabled) run connects to stdio and would hang the test process
    // waiting for a client.
    expect(isDisabledByEnv()).toBe(false);
  });

  it('leaves it enabled when unset', () => {
    delete process.env.CLOUDRIFT_DISABLE_MCP;
    expect(isDisabledByEnv()).toBe(false);
  });
});
