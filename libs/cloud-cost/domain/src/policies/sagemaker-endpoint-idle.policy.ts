// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { SageMakerEndpointIdle } from '../entities/sagemaker-endpoint-idle.entity';

export class SageMakerEndpointIdlePolicy extends WastePolicy<SageMakerEndpointIdle> {
  protected judge(endpoint: SageMakerEndpointIdle, now: Date): WasteVerdict {
    if (endpoint.status !== 'InService') return notWaste(`status is ${endpoint.status}, not InService`);
    if (endpoint.invocationsLastWindow > 0) return notWaste('has invocations');
    if (this.isWithinGracePeriod(endpoint.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`InService, zero invocations over ${endpoint.windowHours}h`);
  }
}
