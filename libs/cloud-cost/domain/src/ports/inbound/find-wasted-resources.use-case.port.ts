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
  totalMonthlyCostUsd: number;
  scanErrors: ResourceScanError[];
}

export interface FindWastedResourcesUseCasePort {
  execute(
    request: FindWastedResourcesRequest,
  ): Promise<Result<WastedResourcesSummary>>;
}
