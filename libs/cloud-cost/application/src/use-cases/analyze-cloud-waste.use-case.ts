// SPDX-License-Identifier: Apache-2.0
import { categoryOf } from 'cloud-cost-domain';
import type {
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  WastedResource,
  ResourceKind,
  AwsRegion,
} from 'cloud-cost-domain';
import { ScanCoordinatorUseCase } from 'shared-scan-coordination';
import type { ScanCoordinatorError } from 'shared-scan-coordination';

/**
 * Orchestration (job scheduling, worker-pool concurrency, per-job error
 * collection) lives in `ScanCoordinatorUseCase` — shared with
 * `FindDeadResourcesUseCase`/`FindResourceSecurityFindingsUseCase`. This
 * class only supplies cloud-cost's own aggregation: splitting findings into
 * waste vs. optimization dollar totals.
 */
export class AnalyzeCloudWasteUseCase
  extends ScanCoordinatorUseCase<ResourceKind, AwsRegion, WastedResource, WastedResourcesSummary>
  implements FindWastedResourcesUseCasePort
{
  protected override buildSummary(
    findings: WastedResource[],
    scanErrors: ScanCoordinatorError<ResourceKind>[],
  ): WastedResourcesSummary {
    let totalWasteMonthlyUsd = 0;
    let totalOptimizationMonthlyUsd = 0;
    for (const finding of findings) {
      const amount = finding.costEstimate.monthlyCostUsd;
      if (categoryOf(finding.kind) === 'waste') {
        totalWasteMonthlyUsd += amount;
      } else {
        totalOptimizationMonthlyUsd += amount;
      }
    }
    return { findings, totalWasteMonthlyUsd, totalOptimizationMonthlyUsd, scanErrors };
  }
}
