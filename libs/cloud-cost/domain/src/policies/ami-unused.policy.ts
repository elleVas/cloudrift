// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { AmiUnused } from '../entities/ami-unused.entity';

export class AmiUnusedPolicy extends WastePolicy<AmiUnused> {
  protected judge(ami: AmiUnused, now: Date): WasteVerdict {
    if (!ami.isUnused()) return notWaste('referenced by an instance or launch template');
    if (this.isWithinGracePeriod(ami.creationDate, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('not referenced by any instance or launch template');
  }
}
