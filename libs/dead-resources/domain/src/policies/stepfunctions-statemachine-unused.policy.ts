// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { StepfunctionsStatemachineUnused } from '../entities/stepfunctions-statemachine-unused.entity';

export class StepfunctionsStatemachineUnusedPolicy extends DeadResourcePolicy<StepfunctionsStatemachineUnused> {
  protected judge(resource: StepfunctionsStatemachineUnused, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
