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
import { defaultAnalyzeDeps } from './analyze-waste.composition';
import { defaultDeadResourcesDeps } from './dead-resources.composition';
import { defaultResourceSecurityDeps } from './resource-security.composition';
import { defaultCostAnalyticsDeps } from './cost-analytics.composition';

const DEFAULT_CLOUDWATCH_WINDOW_HOURS = 48;
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

/**
 * Injection seam for `mcp.command.ts`, mirroring `AnalyzeDeps`/`DeadResourcesDeps`:
 * everything that touches AWS or the filesystem passes through here.
 */
export interface McpDeps {
  runAggregateAnalysis(input: McpAnalyzeInput): Promise<Result<AggregateAnalysisReportDto, Error>>;
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

export const defaultMcpDeps: McpDeps = {
  runAggregateAnalysis: defaultRunAggregateAnalysis,
};
