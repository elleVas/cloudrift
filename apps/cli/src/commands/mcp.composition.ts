// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import { AwsRegion } from 'cloud-cost-domain';
import { toWasteReportDto, type WasteReportDto } from 'cloud-cost-application';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';
import { toDeadResourceReportDto, type DeadResourcesReportDto } from 'dead-resources-application';
import {
  toResourceSecurityReportDto,
  type ResourceSecurityReportDto,
} from 'resource-security-application';
import { CostTrendUseCase, toCostTrendDto, type CostTrendDto } from 'cost-analytics-application';
import { AggregateAnalysisUseCase } from 'mcp-server-application';
import type { AggregateAnalysisDomain } from 'mcp-server-application';
import { loadConfig, type CloudriftConfig } from '../config/cloudrift.config';
import { resolveServiceNames } from '../config/cost-explorer-service-names';
import { defaultAnalyzeDeps } from './analyze-waste.composition';
import { defaultDeadResourcesDeps } from './dead-resources.composition';
import { defaultResourceSecurityDeps } from './resource-security.composition';
import { defaultCostAnalyticsDeps } from './cost-analytics.composition';

const DEFAULT_CLOUDWATCH_WINDOW_HOURS = 336;
const DEFAULT_UTILIZATION_WINDOW_HOURS = 168;

/** Maps 1:1 to `analyze_cloudrift`'s Zod input schema in `mcp.command.ts`. */
export interface McpAnalyzeInput {
  regions?: string[];
  livePricing?: boolean;
  minAgeDays?: number;
  ignoreTag?: string;
  configPath?: string;
}

/**
 * JSON-safe report `analyze_cloudrift` returns. Each present field is a DTO
 * (`toWasteReportDto`/`toDeadResourceReportDto`/`toResourceSecurityReportDto`/
 * `toCostTrendDto`) — never the raw `WastedResourcesSummary`/etc. those DTOs
 * are built from: `findings[]` in those summaries are domain entity
 * instances whose data lives behind getters (`private readonly props`),
 * which `JSON.stringify` silently drops (no enumerable own properties).
 * `domainErrors[].error` is flattened to `message: string` for the same
 * reason (a raw `Error` serializes to `{}`).
 */
export interface AggregateAnalysisReportDto {
  cloudWaste?: WasteReportDto;
  deadResources?: DeadResourcesReportDto;
  resourceSecurity?: ResourceSecurityReportDto;
  costTrend?: CostTrendDto;
  domainErrors: Array<{ domain: AggregateAnalysisDomain; message: string }>;
}

/** Maps 1:1 to `get_cost_trend`'s Zod input schema in `mcp.command.ts`. */
export interface McpCostTrendInput {
  months?: number;
  services?: string[];
  accountId?: string;
  refreshCache?: boolean;
}

/** Maps 1:1 to `analyze_cloud_waste`'s Zod input schema in `mcp.command.ts`. */
export interface McpCloudWasteInput {
  regions?: string[];
  livePricing?: boolean;
  minAgeDays?: number;
  ignoreTag?: string;
  configPath?: string;
}

/** Maps 1:1 to `analyze_dead_resources`'s Zod input schema in `mcp.command.ts`. */
export interface McpDeadResourcesInput {
  regions?: string[];
  minAgeDays?: number;
  ignoreTag?: string;
  configPath?: string;
}

/**
 * Maps 1:1 to `analyze_resource_security`'s Zod input schema in
 * `mcp.command.ts`. No `minAgeDays`: resource-security checks don't take a
 * grace period, same as the `resourceSecurity` branch of
 * `defaultRunAggregateAnalysis` below.
 */
export interface McpResourceSecurityInput {
  regions?: string[];
  ignoreTag?: string;
  configPath?: string;
}

/**
 * Injection seam for `mcp.command.ts`, mirroring `AnalyzeDeps`/`DeadResourcesDeps`:
 * everything that touches AWS or the filesystem passes through here.
 */
export interface McpDeps {
  runAggregateAnalysis(input: McpAnalyzeInput): Promise<Result<AggregateAnalysisReportDto, Error>>;
  runCostTrend(input: McpCostTrendInput): Promise<Result<CostTrendDto, Error>>;
  runCloudWaste(input: McpCloudWasteInput): Promise<Result<WasteReportDto, Error>>;
  runDeadResources(input: McpDeadResourcesInput): Promise<Result<DeadResourcesReportDto, Error>>;
  runResourceSecurity(input: McpResourceSecurityInput): Promise<Result<ResourceSecurityReportDto, Error>>;
}

/** Shape shared by every per-domain and aggregate analysis tool's input. */
interface McpScanScope {
  regions?: string[];
  configPath?: string;
}

interface ResolvedMcpScope {
  config: CloudriftConfig;
  regions: AwsRegion[];
  accountId: string;
}

/**
 * Config loading, region parsing, and account resolution — the preamble
 * every analysis tool needs before it can build its own domain-specific
 * `policyOptions`. Factored out once four tools (`analyze_cloudrift` plus
 * the three per-domain tools below) needed the exact same steps.
 */
async function resolveMcpScope(input: McpScanScope): Promise<Result<ResolvedMcpScope, Error>> {
  const configResult = await loadConfig(process.cwd(), input.configPath);
  if (!configResult.ok) return configResult;
  const config: CloudriftConfig = configResult.value;

  const regions: AwsRegion[] = [];
  for (const code of input.regions ?? ['us-east-1']) {
    const parsed = AwsRegion.parse(code);
    if (!parsed.ok) return parsed;
    regions.push(parsed.value);
  }

  const accountId = (await resolveAwsAccountId()) ?? 'unknown';
  return Result.ok({ config, regions, accountId });
}

/**
 * Wires the four existing composition roots into `AggregateAnalysisUseCase` —
 * the same `defaultAnalyzeDeps`/`defaultDeadResourcesDeps`/
 * `defaultResourceSecurityDeps`/`defaultCostAnalyticsDeps` objects the
 * `analyze`/`dead-resources`/`resource-security`/`trend` commands already
 * use, just composed once instead of run as four separate commands — then
 * projects the result through the same DTO builders those commands' own
 * `--format json` uses, for the same reason: JSON-safety.
 */
async function defaultRunAggregateAnalysis(
  input: McpAnalyzeInput,
): Promise<Result<AggregateAnalysisReportDto, Error>> {
  const scope = await resolveMcpScope(input);
  if (!scope.ok) return scope;
  const { config, regions, accountId } = scope.value;
  const minAgeDays = input.minAgeDays ?? config.minAgeDays;
  const ignoreTag = input.ignoreTag ?? config.ignoreTag;

  const [cloudWasteAnalysis, deadResourcesAnalysis, resourceSecurityAnalysis] = await Promise.all([
    defaultAnalyzeDeps.createAnalysis({
      regions,
      config,
      accountId,
      livePricing: input.livePricing === true,
      policyOptions: { minAgeDays, ignoreTag, excludeTagValues: config.excludeTagValues },
      cloudwatchWindowHours: config.cloudwatchWindowHours ?? DEFAULT_CLOUDWATCH_WINDOW_HOURS,
      utilizationWindowHours: config.utilizationWindowHours ?? DEFAULT_UTILIZATION_WINDOW_HOURS,
      info: () => undefined,
    }),
    defaultDeadResourcesDeps.createAnalysis({
      regions,
      accountId,
      policyOptions: { minAgeDays, ignoreTag, excludeTagValues: config.excludeTagValues },
    }),
    defaultResourceSecurityDeps.createAnalysis({
      regions,
      accountId,
      policyOptions: { ignoreTag, excludeTagValues: config.excludeTagValues },
    }),
  ]);

  const costTrendUseCase = new CostTrendUseCase(defaultCostAnalyticsDeps.createCostExplorer(accountId, false));

  const useCase = new AggregateAnalysisUseCase(
    cloudWasteAnalysis.useCase,
    deadResourcesAnalysis.useCase,
    resourceSecurityAnalysis.useCase,
    costTrendUseCase,
  );

  const result = await useCase.execute({ regions });
  cloudWasteAnalysis.dispose?.();
  if (!result.ok) return result;

  const generatedAt = new Date();
  const regionCodes = regions.map((r) => r.code);
  const report = result.value;

  return Result.ok({
    cloudWaste: report.cloudWaste
      ? toWasteReportDto(report.cloudWaste, {
          accountId,
          regions: regionCodes,
          generatedAt,
          pricesAsOf: cloudWasteAnalysis.pricesAsOf,
        })
      : undefined,
    deadResources: report.deadResources
      ? toDeadResourceReportDto(report.deadResources, { accountId, regions: regionCodes, generatedAt })
      : undefined,
    resourceSecurity: report.resourceSecurity
      ? toResourceSecurityReportDto(report.resourceSecurity, { accountId, regions: regionCodes, generatedAt })
      : undefined,
    costTrend: report.costTrend ? toCostTrendDto(report.costTrend, { accountId, generatedAt }) : undefined,
    domainErrors: report.domainErrors.map(({ domain, error }) => ({ domain, message: error.message })),
  });
}

/**
 * Wires the same `defaultCostAnalyticsDeps`/`CostTrendUseCase` the `trend`
 * command uses, skipping the interactive `confirmCostExplorerCharge` prompt
 * — there's no terminal to confirm against over MCP, same reasoning that
 * already applies to `costTrend` inside `defaultRunAggregateAnalysis`.
 */
async function defaultRunCostTrend(input: McpCostTrendInput): Promise<Result<CostTrendDto, Error>> {
  const services = input.services ? resolveServiceNames(input.services) : undefined;
  const accountId = input.accountId ?? (await resolveAwsAccountId()) ?? 'unknown';
  const costExplorer = defaultCostAnalyticsDeps.createCostExplorer(accountId, input.refreshCache === true);

  const result = await new CostTrendUseCase(costExplorer).execute({ months: input.months, services });
  if (!result.ok) return result;

  return Result.ok(toCostTrendDto(result.value, { accountId, generatedAt: new Date() }));
}

/**
 * Single-domain sibling of `defaultRunAggregateAnalysis` for `analyze_cloud_waste`
 * — same `defaultAnalyzeDeps` composition root, minus the other three domains.
 */
async function defaultRunCloudWaste(input: McpCloudWasteInput): Promise<Result<WasteReportDto, Error>> {
  const scope = await resolveMcpScope(input);
  if (!scope.ok) return scope;
  const { config, regions, accountId } = scope.value;
  const minAgeDays = input.minAgeDays ?? config.minAgeDays;
  const ignoreTag = input.ignoreTag ?? config.ignoreTag;

  const analysis = await defaultAnalyzeDeps.createAnalysis({
    regions,
    config,
    accountId,
    livePricing: input.livePricing === true,
    policyOptions: { minAgeDays, ignoreTag, excludeTagValues: config.excludeTagValues },
    cloudwatchWindowHours: config.cloudwatchWindowHours ?? DEFAULT_CLOUDWATCH_WINDOW_HOURS,
    utilizationWindowHours: config.utilizationWindowHours ?? DEFAULT_UTILIZATION_WINDOW_HOURS,
    info: () => undefined,
  });

  const result = await analysis.useCase.execute({ regions });
  analysis.dispose?.();
  if (!result.ok) return result;

  return Result.ok(
    toWasteReportDto(result.value, {
      accountId,
      regions: regions.map((r) => r.code),
      generatedAt: new Date(),
      pricesAsOf: analysis.pricesAsOf,
    }),
  );
}

/**
 * Single-domain sibling of `defaultRunAggregateAnalysis` for `analyze_dead_resources`
 * — same `defaultDeadResourcesDeps` composition root, minus the other three domains.
 */
async function defaultRunDeadResources(input: McpDeadResourcesInput): Promise<Result<DeadResourcesReportDto, Error>> {
  const scope = await resolveMcpScope(input);
  if (!scope.ok) return scope;
  const { config, regions, accountId } = scope.value;
  const minAgeDays = input.minAgeDays ?? config.minAgeDays;
  const ignoreTag = input.ignoreTag ?? config.ignoreTag;

  const analysis = await defaultDeadResourcesDeps.createAnalysis({
    regions,
    accountId,
    policyOptions: { minAgeDays, ignoreTag, excludeTagValues: config.excludeTagValues },
  });

  const result = await analysis.useCase.execute({ regions });
  if (!result.ok) return result;

  return Result.ok(
    toDeadResourceReportDto(result.value, { accountId, regions: regions.map((r) => r.code), generatedAt: new Date() }),
  );
}

/**
 * Single-domain sibling of `defaultRunAggregateAnalysis` for `analyze_resource_security`
 * — same `defaultResourceSecurityDeps` composition root, minus the other three domains.
 */
async function defaultRunResourceSecurity(
  input: McpResourceSecurityInput,
): Promise<Result<ResourceSecurityReportDto, Error>> {
  const scope = await resolveMcpScope(input);
  if (!scope.ok) return scope;
  const { config, regions, accountId } = scope.value;
  const ignoreTag = input.ignoreTag ?? config.ignoreTag;

  const analysis = await defaultResourceSecurityDeps.createAnalysis({
    regions,
    accountId,
    policyOptions: { ignoreTag, excludeTagValues: config.excludeTagValues },
  });

  const result = await analysis.useCase.execute({ regions });
  if (!result.ok) return result;

  return Result.ok(
    toResourceSecurityReportDto(result.value, { accountId, regions: regions.map((r) => r.code), generatedAt: new Date() }),
  );
}

export const defaultMcpDeps: McpDeps = {
  runAggregateAnalysis: defaultRunAggregateAnalysis,
  runCostTrend: defaultRunCostTrend,
  runCloudWaste: defaultRunCloudWaste,
  runDeadResources: defaultRunDeadResources,
  runResourceSecurity: defaultRunResourceSecurity,
};
