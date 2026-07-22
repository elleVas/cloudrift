// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { KinesisStream } from '../entities/kinesis-stream.entity';

export class KinesisProvisionedIdleStreamPolicy extends WastePolicy<KinesisStream> {
  protected judge(stream: KinesisStream, now: Date): WasteVerdict {
    if (!stream.isIdle()) return notWaste('has incoming records');
    if (this.isWithinGracePeriod(stream.streamCreationTimestamp, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero incoming records in last ${stream.metricWindowHours}h`);
  }
}
