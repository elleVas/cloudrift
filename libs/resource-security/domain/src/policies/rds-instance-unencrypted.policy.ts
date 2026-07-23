// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { RdsInstanceUnencrypted } from '../entities/rds-instance-unencrypted.entity';

/** The scanner only emits instances already confirmed unencrypted. */
export class RdsInstanceUnencryptedPolicy extends ResourceSecurityPolicy<RdsInstanceUnencrypted> {
  protected judge(resource: RdsInstanceUnencrypted): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
