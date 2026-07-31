// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { GuarddutyNotEnabled } from '../entities/guardduty-not-enabled.entity';

/** The scanner only emits a finding for regions with no detector — always flagged once emitted. */
export class GuarddutyNotEnabledPolicy extends ResourceSecurityPolicy<GuarddutyNotEnabled> {
  protected judge(resource: GuarddutyNotEnabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
