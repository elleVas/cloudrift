// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { ResourceSecurityKind, SecurityFinding, ResourceSecuritySeverity } from '../../resource-security';

export interface FindResourceSecurityFindingsRequest {
  regions: AwsRegion[];
}

export interface ResourceSecurityScanError {
  kind: ResourceSecurityKind;
  region: string;
  error: Error;
}

export interface ResourceSecuritySummary {
  findings: SecurityFinding[];
  /** Count of findings per severity — the headline instead of a dollar total. */
  countBySeverity: Record<ResourceSecuritySeverity, number>;
  scanErrors: ResourceSecurityScanError[];
}

export interface FindResourceSecurityFindingsUseCasePort {
  execute(request: FindResourceSecurityFindingsRequest): Promise<Result<ResourceSecuritySummary>>;
}
