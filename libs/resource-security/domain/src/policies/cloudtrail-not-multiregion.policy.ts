// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, notFlagged, type RiskVerdict } from './resource-security-policy';
import type { CloudtrailNotMultiregion } from '../entities/cloudtrail-not-multiregion.entity';

export class CloudtrailNotMultiregionPolicy extends ResourceSecurityPolicy<CloudtrailNotMultiregion> {
  protected judge(resource: CloudtrailNotMultiregion): RiskVerdict {
    return resource.hasMultiRegionTrail ? notFlagged('a multi-region trail exists') : flagged(resource.riskReason);
  }
}
