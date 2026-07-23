// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, notFlagged, type RiskVerdict } from './resource-security-policy';
import type { IamRootMfaDisabled } from '../entities/iam-root-mfa-disabled.entity';

export class IamRootMfaDisabledPolicy extends ResourceSecurityPolicy<IamRootMfaDisabled> {
  protected judge(resource: IamRootMfaDisabled): RiskVerdict {
    return resource.mfaEnabled ? notFlagged('root MFA is enabled') : flagged(resource.riskReason);
  }
}
