// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { LoadBalancer } from '../entities/load-balancer.entity';

export class LoadBalancerWastePolicy extends WastePolicy<LoadBalancer> {
  protected judge(lb: LoadBalancer, now: Date): WasteVerdict {
    if (!lb.isIdle()) return notWaste('has registered targets');
    if (this.isWithinGracePeriod(lb.createdTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no registered targets');
  }
}
