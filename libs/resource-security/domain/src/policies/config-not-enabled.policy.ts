// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { ConfigNotEnabled } from '../entities/config-not-enabled.entity';

/** The scanner only emits a finding for regions with no recording configuration recorder — always flagged once emitted. */
export class ConfigNotEnabledPolicy extends ResourceSecurityPolicy<ConfigNotEnabled> {
  protected judge(resource: ConfigNotEnabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
