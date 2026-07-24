// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RESOURCE_KINDS, RESOURCE_KIND_META } from 'cloud-cost-domain';
import { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META } from 'dead-resources-domain';
import { RESOURCE_SECURITY_KINDS, RESOURCE_SECURITY_KIND_META } from 'resource-security-domain';
import { PDF_LOGO_PNG_BASE64 } from '../pdf-logo-data';
import { defaultMcpDeps, type McpDeps } from './mcp.composition';

const SERVER_VERSION = '0.6.0';

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

/**
 * Read-only IAM actions cloudrift needs for `analyze_cloudrift` (which
 * always scans all four domains). Kept in sync by hand with
 * `docs/en/iam-permissions.md` — the union of its base policy,
 * `dead-resources` block, `resource-security` block, and `ce:GetCostAndUsage`
 * (needed here unconditionally: `analyze_cloudrift` always includes the
 * cost-trend domain, unlike the standalone `analyze` command).
 */
const REQUIRED_IAM_POLICY = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: [
        'ec2:DescribeVolumes',
        'ec2:DescribeAddresses',
        'ec2:DescribeInstances',
        'ec2:DescribeSnapshots',
        'ec2:DescribeImages',
        'ec2:DescribeNatGateways',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeLaunchTemplates',
        'ec2:DescribeLaunchTemplateVersions',
        'ec2:DescribeKeyPairs',
        'ec2:DescribeReservedInstances',
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeRegions',
        'ec2:DescribeSnapshotAttribute',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:DescribeAlarms',
        'rds:DescribeDBInstances',
        'rds:DescribeDBClusters',
        'rds:DescribeDBSnapshots',
        'elasticloadbalancing:DescribeLoadBalancers',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetHealth',
        'logs:DescribeLogGroups',
        's3:ListAllMyBuckets',
        's3:ListBucket',
        's3:GetBucketLifecycleConfiguration',
        's3:ListMultipartUploadParts',
        's3:ListBucketMultipartUploads',
        's3:GetBucketAcl',
        's3:GetBucketPolicyStatus',
        's3:GetPublicAccessBlock',
        's3:GetBucketEncryption',
        'ecr:DescribeRepositories',
        'ecr:DescribeImages',
        'codepipeline:ListPipelines',
        'codepipeline:ListPipelineExecutions',
        'secretsmanager:ListSecrets',
        'lambda:ListFunctions',
        'elasticfilesystem:DescribeFileSystems',
        'dynamodb:ListTables',
        'dynamodb:DescribeTable',
        'elasticache:DescribeCacheClusters',
        'sagemaker:ListNotebookInstances',
        'sagemaker:ListEndpoints',
        'sagemaker:DescribeEndpoint',
        'sagemaker:DescribeEndpointConfig',
        'sagemaker:ListEndpointConfigs',
        'sagemaker:ListModels',
        'sagemaker:DescribeModel',
        'sagemaker:ListTags',
        'sqs:ListQueues',
        'sqs:GetQueueAttributes',
        'sqs:ListDeadLetterSourceQueues',
        'sqs:ListQueueTags',
        'tag:GetResources',
        'eks:ListClusters',
        'eks:ListNodegroups',
        'eks:DescribeNodegroup',
        'iam:ListUsers',
        'iam:ListAccessKeys',
        'iam:GetAccessKeyLastUsed',
        'iam:ListPolicies',
        'iam:ListRoles',
        'iam:ListInstanceProfiles',
        'iam:GetAccountSummary',
        'iam:ListMFADevices',
        'iam:GetAccountPasswordPolicy',
        'acm:ListCertificates',
        'route53:ListHostedZones',
        'cloudformation:DescribeStacks',
        'sns:ListTopics',
        'sns:ListSubscriptionsByTopic',
        'events:ListRules',
        'events:ListTargetsByRule',
        'states:ListStateMachines',
        'states:ListExecutions',
        'cloudtrail:DescribeTrails',
        'ce:GetCostAndUsage',
        'sts:GetCallerIdentity',
      ],
      Resource: '*',
    },
  ],
} as const;

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function buildResourceTypesCatalog() {
  return [
    ...RESOURCE_KINDS.map((kind) => ({
      domain: 'cloudWaste' as const,
      kind,
      label: RESOURCE_KIND_META[kind].label,
      category: RESOURCE_KIND_META[kind].category,
      estimated: RESOURCE_KIND_META[kind].estimated,
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
    async (args) => {
      const result = await deps.runAggregateAnalysis(args);
      if (!result.ok) return errorResult(result.error.message);
      return jsonResult(result.value);
    },
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
    async () => jsonResult(buildResourceTypesCatalog()),
  );

  server.registerTool(
    'get_required_iam_permissions',
    {
      title: 'Get required IAM permissions',
      description:
        'Returns the read-only IAM policy the AWS principal needs for analyze_cloudrift (union of all four ' +
        'domains). Static — no AWS calls. --live-pricing (pricing:GetProducts) is not included: pass ' +
        'livePricing to analyze_cloudrift only if you also grant that action separately.',
      inputSchema: {},
    },
    async () => jsonResult(REQUIRED_IAM_POLICY),
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
