// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { IamInstanceProfileUnattached } from '../entities/iam-instance-profile-unattached.entity';

export class IamInstanceProfileUnattachedPolicy extends DeadResourcePolicy<IamInstanceProfileUnattached> {
  protected judge(resource: IamInstanceProfileUnattached, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
