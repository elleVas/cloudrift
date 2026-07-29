// SPDX-License-Identifier: Apache-2.0
import type {
  FindResourceSecurityFindingsUseCasePort,
  ResourceSecuritySummary,
  SecurityFinding,
  ResourceSecurityKind,
  ResourceSecuritySeverity,
  AwsRegion,
} from 'resource-security-domain';
import { ScanCoordinatorUseCase } from 'shared-scan-coordination';
import type { ScanCoordinatorError } from 'shared-scan-coordination';

/**
 * Orchestration (job scheduling, worker-pool concurrency, per-job error
 * collection) lives in `ScanCoordinatorUseCase` — shared with
 * `AnalyzeCloudWasteUseCase`/`FindDeadResourcesUseCase`. This class only
 * supplies resource-security's own aggregation: counting findings by
 * severity.
 */
export class FindResourceSecurityFindingsUseCase
  extends ScanCoordinatorUseCase<ResourceSecurityKind, AwsRegion, SecurityFinding, ResourceSecuritySummary>
  implements FindResourceSecurityFindingsUseCasePort
{
  protected override buildSummary(
    findings: SecurityFinding[],
    scanErrors: ScanCoordinatorError<ResourceSecurityKind>[],
  ): ResourceSecuritySummary {
    const countBySeverity: Record<ResourceSecuritySeverity, number> = { info: 0, warning: 0, critical: 0 };
    for (const finding of findings) {
      countBySeverity[finding.severity]++;
    }
    return { findings, countBySeverity, scanErrors };
  }
}
