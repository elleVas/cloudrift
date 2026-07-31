// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { VpcFlowLogsDisabled } from '../entities/vpc-flow-logs-disabled.entity';

/** The scanner only emits VPCs with no active Flow Log — always flagged once emitted. */
export class VpcFlowLogsDisabledPolicy extends ResourceSecurityPolicy<VpcFlowLogsDisabled> {
  protected judge(resource: VpcFlowLogsDisabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
