// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, notFlagged, type RiskVerdict } from './resource-security-policy';
import type { IamPasswordPolicyWeak } from '../entities/iam-password-policy-weak.entity';

export class IamPasswordPolicyWeakPolicy extends ResourceSecurityPolicy<IamPasswordPolicyWeak> {
  protected judge(resource: IamPasswordPolicyWeak): RiskVerdict {
    return resource.isWeak ? flagged(resource.riskReason) : notFlagged('meets CIS baseline');
  }
}
