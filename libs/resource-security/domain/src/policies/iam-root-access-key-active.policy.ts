// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, notFlagged, type RiskVerdict } from './resource-security-policy';
import type { IamRootAccessKeyActive } from '../entities/iam-root-access-key-active.entity';

export class IamRootAccessKeyActivePolicy extends ResourceSecurityPolicy<IamRootAccessKeyActive> {
  protected judge(resource: IamRootAccessKeyActive): RiskVerdict {
    return resource.accessKeysPresent ? flagged(resource.riskReason) : notFlagged('root has no access keys');
  }
}
