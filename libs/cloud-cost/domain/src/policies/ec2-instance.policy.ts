// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { Ec2Instance } from '../entities/ec2-instance.entity';

export class Ec2InstanceWastePolicy extends WastePolicy<Ec2Instance> {
  protected judge(instance: Ec2Instance, now: Date): WasteVerdict {
    if (!instance.isStopped()) return notWaste('not stopped');
    const stoppedSince = instance.stoppedSince ?? instance.launchTime;
    if (this.isWithinGracePeriod(stoppedSince, now)) {
      return notWaste(`stopped less than ${this.minAgeDays}d ago`);
    }
    return waste('stopped (attached EBS still billed)');
  }
}
