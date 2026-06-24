// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { ResourceKind, WastedResource } from '../../wasted-resource';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

/**
 * Single outbound port for waste detection: each resource type is
 * an implementation (plugin) of this port. The contract
 * requires the scanner to return only resources already confirmed as
 * waste by the corresponding domain waste policy.
 */
export interface WasteScannerPort {
  readonly kind: ResourceKind;
  scan(region: AwsRegion): Promise<Result<WastedResource[]>>;
}
