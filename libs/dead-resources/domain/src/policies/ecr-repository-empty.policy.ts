// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { EcrRepositoryEmpty } from '../entities/ecr-repository-empty.entity';

export class EcrRepositoryEmptyPolicy extends DeadResourcePolicy<EcrRepositoryEmpty> {
  protected judge(resource: EcrRepositoryEmpty, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
