// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { SageMakerTrainingOrphaned } from '../entities/sagemaker-training-orphaned.entity';

export class SageMakerTrainingOrphanedPolicy extends WastePolicy<SageMakerTrainingOrphaned> {
  protected judge(model: SageMakerTrainingOrphaned, now: Date): WasteVerdict {
    if (model.referencedByEndpointConfig) return notWaste('referenced by an endpoint config');
    if (this.isWithinGracePeriod(model.creationTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('not referenced by any endpoint config');
  }
}
