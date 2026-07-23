// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, notFlagged, type HygieneVerdict } from './dead-resource-policy';
import type { Ec2KeyPairUnused } from '../entities/ec2-keypair-unused.entity';

export class Ec2KeyPairUnusedPolicy extends DeadResourcePolicy<Ec2KeyPairUnused> {
  protected judge(resource: Ec2KeyPairUnused, now: Date): HygieneVerdict {
    if (this.isWithinGracePeriod(resource.createdAt, now)) {
      return notFlagged('within grace period');
    }
    return flagged(resource.hygieneReason);
  }
}
