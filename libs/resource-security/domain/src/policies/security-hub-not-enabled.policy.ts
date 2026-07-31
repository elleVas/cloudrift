// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { SecurityHubNotEnabled } from '../entities/security-hub-not-enabled.entity';

/** The scanner only emits a finding for regions where Security Hub isn't enabled — always flagged once emitted. */
export class SecurityHubNotEnabledPolicy extends ResourceSecurityPolicy<SecurityHubNotEnabled> {
  protected judge(resource: SecurityHubNotEnabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
