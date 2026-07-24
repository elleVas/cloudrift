// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { FindWastedResourcesUseCasePort, WastedResourcesSummary } from 'cloud-cost-domain';
import type { FindDeadResourcesUseCasePort, DeadResourcesSummary } from 'dead-resources-domain';
import type {
  FindResourceSecurityFindingsUseCasePort,
  ResourceSecuritySummary,
} from 'resource-security-domain';
import type { CostTrendUseCasePort, CostTrendRequest, CostTrendSummary } from 'cost-analytics-domain';

export type AggregateAnalysisDomain = 'cloudWaste' | 'deadResources' | 'resourceSecurity' | 'costTrend';

export interface AggregateAnalysisDomainError {
  domain: AggregateAnalysisDomain;
  error: Error;
}

export interface AggregateAnalysisRequest {
  regions: AwsRegion[];
  costTrend?: CostTrendRequest;
}

export interface AggregateAnalysisReport {
  cloudWaste?: WastedResourcesSummary;
  deadResources?: DeadResourcesSummary;
  resourceSecurity?: ResourceSecuritySummary;
  costTrend?: CostTrendSummary;
  /**
   * One entry per domain whose use case returned `Result.fail` outright —
   * distinct from each domain's own per-(kind, region) `scanErrors`, which
   * stay nested inside that domain's summary. A failure here means that
   * domain's summary is absent from the report; the other three are
   * unaffected (same graceful-degradation contract as `scanErrors`).
   */
  domainErrors: AggregateAnalysisDomainError[];
}

/**
 * Orchestrates the four existing domain use cases behind their inbound
 * ports — no AWS/infra knowledge, no new domain logic. Composition roots
 * (e.g. the CLI's `mcp` subcommand) wire in the concrete use cases already
 * built for `analyze`, `dead-resources`, `resource-security` and `trend`.
 */
export class AggregateAnalysisUseCase {
  constructor(
    private readonly cloudWaste: FindWastedResourcesUseCasePort,
    private readonly deadResources: FindDeadResourcesUseCasePort,
    private readonly resourceSecurity: FindResourceSecurityFindingsUseCasePort,
    private readonly costTrend: CostTrendUseCasePort,
  ) {}

  async execute(request: AggregateAnalysisRequest): Promise<Result<AggregateAnalysisReport>> {
    const { regions } = request;

    const [cloudWasteResult, deadResourcesResult, resourceSecurityResult, costTrendResult] =
      await Promise.all([
        this.cloudWaste.execute({ regions }),
        this.deadResources.execute({ regions }),
        this.resourceSecurity.execute({ regions }),
        this.costTrend.execute(request.costTrend ?? {}),
      ]);

    const domainErrors: AggregateAnalysisDomainError[] = [];
    const report: AggregateAnalysisReport = { domainErrors };

    if (cloudWasteResult.ok) {
      report.cloudWaste = cloudWasteResult.value;
    } else {
      domainErrors.push({ domain: 'cloudWaste', error: cloudWasteResult.error });
    }

    if (deadResourcesResult.ok) {
      report.deadResources = deadResourcesResult.value;
    } else {
      domainErrors.push({ domain: 'deadResources', error: deadResourcesResult.error });
    }

    if (resourceSecurityResult.ok) {
      report.resourceSecurity = resourceSecurityResult.value;
    } else {
      domainErrors.push({ domain: 'resourceSecurity', error: resourceSecurityResult.error });
    }

    if (costTrendResult.ok) {
      report.costTrend = costTrendResult.value;
    } else {
      domainErrors.push({ domain: 'costTrend', error: costTrendResult.error });
    }

    return Result.ok(report);
  }
}
