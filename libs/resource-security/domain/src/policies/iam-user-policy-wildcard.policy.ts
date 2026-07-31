// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { IamUserPolicyWildcard } from '../entities/iam-user-policy-wildcard.entity';

/** The scanner only emits users it already found a wildcard-admin policy on — always flagged once emitted. */
export class IamUserPolicyWildcardPolicy extends ResourceSecurityPolicy<IamUserPolicyWildcard> {
  protected judge(resource: IamUserPolicyWildcard): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
