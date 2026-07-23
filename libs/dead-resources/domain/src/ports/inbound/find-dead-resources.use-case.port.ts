// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResourceKind, DeadResource, DeadResourceSeverity } from '../../dead-resource';

export interface FindDeadResourcesRequest {
  regions: AwsRegion[];
}

export interface DeadResourceScanError {
  kind: DeadResourceKind;
  region: string;
  error: Error;
}

export interface DeadResourcesSummary {
  findings: DeadResource[];
  /** Count of findings per severity — the headline instead of a dollar total. */
  countBySeverity: Record<DeadResourceSeverity, number>;
  scanErrors: DeadResourceScanError[];
}

export interface FindDeadResourcesUseCasePort {
  execute(request: FindDeadResourcesRequest): Promise<Result<DeadResourcesSummary>>;
}
