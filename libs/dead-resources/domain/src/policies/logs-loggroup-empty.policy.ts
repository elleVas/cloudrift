// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { LogsLogGroupEmpty } from '../entities/logs-loggroup-empty.entity';

export class LogsLogGroupEmptyPolicy extends DeadResourcePolicy<LogsLogGroupEmpty> {
  protected judge(resource: LogsLogGroupEmpty, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
