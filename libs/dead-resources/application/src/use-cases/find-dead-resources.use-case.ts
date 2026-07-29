// SPDX-License-Identifier: Apache-2.0
import type {
  FindDeadResourcesUseCasePort,
  DeadResourcesSummary,
  DeadResource,
  DeadResourceKind,
  DeadResourceSeverity,
  AwsRegion,
} from 'dead-resources-domain';
import { ScanCoordinatorUseCase } from 'shared-scan-coordination';
import type { ScanCoordinatorError } from 'shared-scan-coordination';

/**
 * Orchestration (job scheduling, worker-pool concurrency, per-job error
 * collection) lives in `ScanCoordinatorUseCase` — shared with
 * `AnalyzeCloudWasteUseCase`/`FindResourceSecurityFindingsUseCase`. This
 * class only supplies dead-resources' own aggregation: counting findings by
 * severity.
 */
export class FindDeadResourcesUseCase
  extends ScanCoordinatorUseCase<DeadResourceKind, AwsRegion, DeadResource, DeadResourcesSummary>
  implements FindDeadResourcesUseCasePort
{
  protected override buildSummary(
    findings: DeadResource[],
    scanErrors: ScanCoordinatorError<DeadResourceKind>[],
  ): DeadResourcesSummary {
    const countBySeverity: Record<DeadResourceSeverity, number> = { info: 0, warning: 0, critical: 0 };
    for (const finding of findings) {
      countBySeverity[finding.severity]++;
    }
    return { findings, countBySeverity, scanErrors };
  }
}
