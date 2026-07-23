// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { CloudformationStackStuck } from '../entities/cloudformation-stack-stuck.entity';

export class CloudformationStackStuckPolicy extends DeadResourcePolicy<CloudformationStackStuck> {
  protected judge(resource: CloudformationStackStuck, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
