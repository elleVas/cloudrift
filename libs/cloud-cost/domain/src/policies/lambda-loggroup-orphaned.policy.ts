// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { LambdaLogGroupOrphaned } from '../entities/lambda-loggroup-orphaned.entity';

export class LambdaLogGroupOrphanedPolicy extends WastePolicy<LambdaLogGroupOrphaned> {
  protected judge(group: LambdaLogGroupOrphaned, now: Date): WasteVerdict {
    if (group.functionExists) return notWaste('function still exists');
    // `null` means no log stream ever recorded an event — that's stronger
    // evidence of orphan status than a recent timestamp, so no grace period
    // applies (unlike a real but recent last-event date).
    if (group.lastEventTimestamp && this.isWithinGracePeriod(group.lastEventTimestamp, now)) {
      return notWaste(`last log event less than ${this.minAgeDays}d ago`);
    }
    return waste(`function ${group.functionName} no longer exists`);
  }
}
