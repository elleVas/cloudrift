// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { IamUserMfaDisabled } from '../entities/iam-user-mfa-disabled.entity';

/** The scanner only emits candidates that already lack MFA, so beyond the shared tag exclusion there is nothing left to judge. */
export class IamUserMfaDisabledPolicy extends ResourceSecurityPolicy<IamUserMfaDisabled> {
  protected judge(resource: IamUserMfaDisabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
