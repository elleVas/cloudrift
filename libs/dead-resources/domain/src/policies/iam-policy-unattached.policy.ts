// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { IamPolicyUnattached } from '../entities/iam-policy-unattached.entity';

export class IamPolicyUnattachedPolicy extends DeadResourcePolicy<IamPolicyUnattached> {
  protected judge(resource: IamPolicyUnattached, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
