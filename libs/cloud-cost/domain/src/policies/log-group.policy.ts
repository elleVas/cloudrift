// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { LogGroup } from '../entities/log-group.entity';

export class LogGroupWastePolicy extends WastePolicy<LogGroup> {
  protected judge(group: LogGroup, now: Date): WasteVerdict {
    if (group.hasRetentionPolicy()) return notWaste('retention policy configured');
    if (this.isWithinGracePeriod(group.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no retention policy');
  }
}
