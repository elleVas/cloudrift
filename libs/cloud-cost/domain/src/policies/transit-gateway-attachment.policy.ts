// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { TransitGatewayAttachment } from '../entities/transit-gateway-attachment.entity';

export class TransitGatewayIdleAttachmentPolicy extends WastePolicy<TransitGatewayAttachment> {
  protected judge(attachment: TransitGatewayAttachment, now: Date): WasteVerdict {
    if (!attachment.isIdle()) return notWaste('has traffic');
    if (this.isWithinGracePeriod(attachment.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero traffic in last ${attachment.metricWindowHours}h`);
  }
}
