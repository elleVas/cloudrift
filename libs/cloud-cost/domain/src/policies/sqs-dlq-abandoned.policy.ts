// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { SqsDlqAbandoned } from '../entities/sqs-dlq-abandoned.entity';

export class SqsDlqAbandonedWastePolicy extends WastePolicy<SqsDlqAbandoned> {
  /** minMessageAgeDays: age of the oldest unconsumed message, not resource age — `minAgeDays`'s grace period does not apply here. */
  constructor(options: WastePolicyOptions = {}, private readonly minMessageAgeDays = 14) {
    super(options);
  }

  protected judge(queue: SqsDlqAbandoned): WasteVerdict {
    if (!queue.identifiedAsDlq) return notWaste('not identified as a DLQ');
    if (queue.approximateNumberOfMessages === 0) return notWaste('no messages');
    const ageDays = queue.oldestMessageAgeSeconds / 86400;
    if (ageDays < this.minMessageAgeDays) {
      return notWaste(`oldest message ${ageDays.toFixed(1)}d old, within ${this.minMessageAgeDays}d grace period`);
    }
    return waste(`oldest message ${ageDays.toFixed(1)}d old, ${queue.approximateNumberOfMessages} unconsumed`);
  }
}
