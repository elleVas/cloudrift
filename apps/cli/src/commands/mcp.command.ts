// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RESOURCE_KINDS, RESOURCE_KIND_META, confidenceOf } from 'cloud-cost-domain';
import { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META } from 'dead-resources-domain';
import { RESOURCE_SECURITY_KINDS, RESOURCE_SECURITY_KIND_META } from 'resource-security-domain';
import { PDF_LOGO_PNG_BASE64 } from '../pdf-logo-data';
import { defaultMcpDeps, type McpDeps } from './mcp.composition';
import { cliVersion } from '../cli-version';
import { REQUIRED_IAM_POLICY } from '../iam-policy';

const SERVER_VERSION = cliVersion;

/**
 * Global kill switch, independent of any project/`cloudrift.config.json`
 * (there may not even be one — `cloudrift mcp` works from any directory).
 * Meant to be set once outside the repo (shell profile, container image,
 * MDM-pushed environment policy) by whoever wants to be sure this machine
 * never starts the MCP server, even by accident.
 */
const DISABLE_ENV_VAR = 'CLOUDRIFT_DISABLE_MCP';

/** Exported for the kill-switch spec — the parsing itself is worth unit-testing directly. */
export function isDisabledByEnv(): boolean {
  const raw = process.env[DISABLE_ENV_VAR];
  return raw === '1' || raw?.toLowerCase() === 'true';
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Every registered tool handler runs inside the MCP SDK's own request
 * dispatch, outside any try/catch of ours — an uncaught throw (a bad
 * `deps` composition, a domain use case rejecting instead of returning
 * `Result.fail`, ...) would otherwise surface as a raw JSON-RPC error to
 * the client instead of the same structured `isError` shape every other
 * failure in this file uses.
 */
function withErrorBoundary<Args extends unknown[]>(
  handler: (...args: Args) => Promise<CallToolResult>,
): (...args: Args) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  };
}

function buildResourceTypesCatalog() {
  return [
    ...RESOURCE_KINDS.map((kind) => ({
      domain: 'cloudWaste' as const,
      kind,
      label: RESOURCE_KIND_META[kind].label,
      category: RESOURCE_KIND_META[kind].category,
      estimated: RESOURCE_KIND_META[kind].estimated,
      confidence: confidenceOf(kind),
    })),
    ...DEAD_RESOURCE_KINDS.map((kind) => ({
      domain: 'deadResources' as const,
      kind,
      label: DEAD_RESOURCE_KIND_META[kind].label,
      scope: DEAD_RESOURCE_KIND_META[kind].scope,
    })),
    ...RESOURCE_SECURITY_KINDS.map((kind) => ({
      domain: 'resourceSecurity' as const,
      kind,
      label: RESOURCE_SECURITY_KIND_META[kind].label,
      scope: RESOURCE_SECURITY_KIND_META[kind].scope,
    })),
  ];
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    {
      name: 'cloudrift',
      version: SERVER_VERSION,
      title: 'cloudrift',
      description: 'Detect and report wasted, dead, or insecurely-configured AWS resources — 100% local, read-only.',
      icons: [{ src: `data:image/png;base64,${PDF_LOGO_PNG_BASE64}`, mimeType: 'image/png' }],
    },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'analyze_cloudrift',
    {
      title: 'Analyze AWS account',
      description:
        'Scans the AWS account (same credentials as the CLI) across all four cloudrift domains — ' +
        'cloud-cost waste, dead/unused resources, resource-security posture, and the cost trend — ' +
        'and returns one aggregated JSON report. Read-only: makes no write/delete AWS API calls.',
      inputSchema: {
        regions: z
          .array(z.string())
          .optional()
          .describe('AWS regions to scan, e.g. ["us-east-1"]. Defaults to ["us-east-1"].'),
        livePricing: z
          .boolean()
          .optional()
          .describe('Fetch current list prices from the AWS Pricing API instead of the static table. Default false.'),
        minAgeDays: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Grace period in days: resources younger than this are not reported. Default 7.'),
        ignoreTag: z
          .string()
          .optional()
          .describe('Resources carrying this tag are excluded from the report. Default "cloudrift:ignore".'),
        configPath: z
          .string()
          .optional()
          .describe('Path to a cloudrift.config.json/.cloudriftrc file, if not in the current directory.'),
      },
    },
    withErrorBoundary(async (args) => {
      const result = await deps.runAggregateAnalysis(args);
      if (!result.ok) return errorResult(result.error.message);
      return jsonResult(result.value);
    }),
  );

  server.registerTool(
    'analyze_cloud_waste',
    {
      title: 'Find wasted AWS spend',
      description:
        'Scans the AWS account (same credentials as the CLI) for wasted/over-provisioned resources — the ' +
        'cloud-cost domain only. A narrower, cheaper alternative to analyze_cloudrift when you only need ' +
        'this one domain. Read-only: makes no write/delete AWS API calls.',
      inputSchema: {
        regions: z
          .array(z.string())
          .optional()
          .describe('AWS regions to scan, e.g. ["us-east-1"]. Defaults to ["us-east-1"].'),
        livePricing: z
          .boolean()
          .optional()
          .describe('Fetch current list prices from the AWS Pricing API instead of the static table. Default false.'),
        minAgeDays: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Grace period in days: resources younger than this are not reported. Default 7.'),
        ignoreTag: z
          .string()
          .optional()
          .describe('Resources carrying this tag are excluded from the report. Default "cloudrift:ignore".'),
        configPath: z
          .string()
          .optional()
          .describe('Path to a cloudrift.config.json/.cloudriftrc file, if not in the current directory.'),
      },
    },
    withErrorBoundary(async (args) => {
      const result = await deps.runCloudWaste(args);
      if (!result.ok) return errorResult(result.error.message);
      return jsonResult(result.value);
    }),
  );

  server.registerTool(
    'analyze_dead_resources',
    {
      title: 'Find dead/unused AWS resources',
      description:
        'Scans the AWS account (same credentials as the CLI) for dead/unused resources — the dead-resources ' +
        'domain only. A narrower, cheaper alternative to analyze_cloudrift when you only need this one ' +
        'domain. Read-only: makes no write/delete AWS API calls.',
      inputSchema: {
        regions: z
          .array(z.string())
          .optional()
          .describe('AWS regions to scan, e.g. ["us-east-1"]. Defaults to ["us-east-1"].'),
        minAgeDays: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Grace period in days: resources younger than this are not reported. Default 7.'),
        ignoreTag: z
          .string()
          .optional()
          .describe('Resources carrying this tag are excluded from the report. Default "cloudrift:ignore".'),
        configPath: z
          .string()
          .optional()
          .describe('Path to a cloudrift.config.json/.cloudriftrc file, if not in the current directory.'),
      },
    },
    withErrorBoundary(async (args) => {
      const result = await deps.runDeadResources(args);
      if (!result.ok) return errorResult(result.error.message);
      return jsonResult(result.value);
    }),
  );

  server.registerTool(
    'analyze_resource_security',
    {
      title: 'Find insecurely-configured AWS resources',
      description:
        'Scans the AWS account (same credentials as the CLI) for insecurely-configured resources — the ' +
        'resource-security domain only. A narrower, cheaper alternative to analyze_cloudrift when you only ' +
        'need this one domain. Read-only: makes no write/delete AWS API calls.',
      inputSchema: {
        regions: z
          .array(z.string())
          .optional()
          .describe('AWS regions to scan, e.g. ["us-east-1"]. Defaults to ["us-east-1"].'),
        ignoreTag: z
          .string()
          .optional()
          .describe('Resources carrying this tag are excluded from the report. Default "cloudrift:ignore".'),
        configPath: z
          .string()
          .optional()
          .describe('Path to a cloudrift.config.json/.cloudriftrc file, if not in the current directory.'),
      },
    },
    withErrorBoundary(async (args) => {
      const result = await deps.runResourceSecurity(args);
      if (!result.ok) return errorResult(result.error.message);
      return jsonResult(result.value);
    }),
  );

  server.registerTool(
    'get_cost_trend',
    {
      title: 'Get AWS cost trend',
      description:
        'Returns monthly AWS spend over the last N calendar months (via Cost Explorer), optionally ' +
        'restricted to specific services. Same credentials as the CLI. Each call queries the AWS Cost ' +
        'Explorer API (a paid API, ~$0.01/request), cached locally once a month has closed.',
      inputSchema: {
        months: z
          .number()
          .int()
          .min(1)
          .max(36)
          .optional()
          .describe('Number of calendar months, including the current partial one. Default 6, max 36.'),
        services: z
          .array(z.string())
          .optional()
          .describe(
            'Cost Explorer service names or shorthands (ec2, ebs, s3, rds, lambda, dynamodb, elasticache, ' +
              'redshift, elb, sqs, sns, cloudfront) to restrict totals to. Default: every service.',
          ),
        accountId: z
          .string()
          .optional()
          .describe('AWS account ID to key the local Cost Explorer cache under. Defaults to the account resolved via STS from ambient credentials.'),
        refreshCache: z
          .boolean()
          .optional()
          .describe('Bypass the local Cost Explorer response cache and refetch from AWS. Default false.'),
      },
    },
    withErrorBoundary(async (args) => {
      const result = await deps.runCostTrend(args);
      if (!result.ok) return errorResult(result.error.message);
      return jsonResult(result.value);
    }),
  );

  server.registerTool(
    'get_resource_types',
    {
      title: 'List detectable resource types',
      description:
        'Lists every resource kind cloudrift can detect across the cloud-cost, dead-resources, and ' +
        'resource-security domains, with its human-readable label. Static — no AWS calls.',
      inputSchema: {},
    },
    withErrorBoundary(async () => jsonResult(buildResourceTypesCatalog())),
  );

  server.registerTool(
    'get_required_iam_permissions',
    {
      title: 'Get required IAM permissions',
      description:
        'Returns the read-only IAM policy the AWS principal needs for analyze_cloudrift and every other ' +
        'AWS-calling tool (analyze_cloud_waste, analyze_dead_resources, analyze_resource_security, ' +
        'get_cost_trend) — the union of all four domains, since none of them need a narrower policy of ' +
        'their own. Static — no AWS calls. --live-pricing (pricing:GetProducts) is not included: pass ' +
        'livePricing to analyze_cloudrift/analyze_cloud_waste only if you also grant that action separately.',
      inputSchema: {},
    },
    withErrorBoundary(async () => jsonResult(REQUIRED_IAM_POLICY)),
  );

  return server;
}

/**
 * `mcp`: exposes cloudrift as a local MCP server over stdio for any MCP
 * client (Claude Desktop/Code, Kiro, VS Code Copilot Chat Agent mode, ...).
 * Inherits the same AWS credentials as every other command — see
 * `docs/en/usage.md#mcp---run-cloudrift-as-a-local-mcp-server` for the
 * security note on what that implies and how to disable this command
 * entirely via `CLOUDRIFT_DISABLE_MCP`.
 */
export async function mcpCommand(deps: McpDeps = defaultMcpDeps): Promise<void> {
  if (isDisabledByEnv()) {
    console.error(
      chalk.red(
        `\n  MCP server disabled: ${DISABLE_ENV_VAR} is set in the environment. Unset it to run "cloudrift mcp".\n`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
}
