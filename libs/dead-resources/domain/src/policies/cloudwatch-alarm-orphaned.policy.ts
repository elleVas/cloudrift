// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { CloudwatchAlarmOrphaned } from '../entities/cloudwatch-alarm-orphaned.entity';

export class CloudwatchAlarmOrphanedPolicy extends DeadResourcePolicy<CloudwatchAlarmOrphaned> {
  protected judge(resource: CloudwatchAlarmOrphaned, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
