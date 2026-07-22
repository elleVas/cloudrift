// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { MqBroker } from '../entities/mq-broker.entity';

export class MqIdleBrokerPolicy extends WastePolicy<MqBroker> {
  protected judge(broker: MqBroker, now: Date): WasteVerdict {
    if (!broker.isIdle()) return notWaste('has network traffic');
    if (this.isWithinGracePeriod(broker.created, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero network traffic in last ${broker.metricWindowHours}h`);
  }
}
