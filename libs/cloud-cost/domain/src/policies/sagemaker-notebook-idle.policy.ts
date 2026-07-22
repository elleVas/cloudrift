// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { SageMakerNotebookIdle } from '../entities/sagemaker-notebook-idle.entity';

export class SageMakerNotebookIdlePolicy extends WastePolicy<SageMakerNotebookIdle> {
  /** maxCpuPercent: maximum CPU threshold below which an InService notebook is "idle". Default 2. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 2) {
    super(options);
  }

  protected judge(notebook: SageMakerNotebookIdle, now: Date): WasteVerdict {
    if (notebook.status !== 'InService') return notWaste(`status is ${notebook.status}, not InService`);
    if (notebook.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    if (this.isWithinGracePeriod(notebook.lastModifiedTime, now)) {
      return notWaste(`last modified less than ${this.minAgeDays}d ago`);
    }
    return waste(`InService, max CPU ${notebook.maxCpuPercent.toFixed(1)}% over ${notebook.windowHours}h`);
  }
}
