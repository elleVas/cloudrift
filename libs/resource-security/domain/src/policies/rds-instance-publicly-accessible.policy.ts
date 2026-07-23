// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { RdsInstancePubliclyAccessible } from '../entities/rds-instance-publicly-accessible.entity';

/** The scanner only emits instances already confirmed publicly accessible. */
export class RdsInstancePubliclyAccessiblePolicy extends ResourceSecurityPolicy<RdsInstancePubliclyAccessible> {
  protected judge(resource: RdsInstancePubliclyAccessible): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
