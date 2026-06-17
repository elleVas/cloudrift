import type { Result } from 'shared-kernel';
import type { ResourceKind, WastedResource } from '../../wasted-resource';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

export interface FindWastedResourcesRequest {
  regions: AwsRegion[];
}

export interface ResourceScanError {
  kind: ResourceKind;
  region: string;
  error: Error;
}

export interface WastedResourcesSummary {
  findings: WastedResource[];
  /** Somma dei finding di categoria `waste` (l'headline e il gate CI). */
  totalWasteMonthlyUsd: number;
  /** Somma dei finding di categoria `optimization` (mostrata a parte). */
  totalOptimizationMonthlyUsd: number;
  scanErrors: ResourceScanError[];
}

export interface FindWastedResourcesUseCasePort {
  execute(
    request: FindWastedResourcesRequest,
  ): Promise<Result<WastedResourcesSummary>>;
}
