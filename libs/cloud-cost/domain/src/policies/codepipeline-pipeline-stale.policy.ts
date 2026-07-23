// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { CodepipelinePipelineStale } from '../entities/codepipeline-pipeline-stale.entity';

export class CodepipelinePipelineStalePolicy extends WastePolicy<CodepipelinePipelineStale> {
  protected judge(pipeline: CodepipelinePipelineStale, now: Date): WasteVerdict {
    const referenceDate = pipeline.lastExecutionAt ?? pipeline.createdAt;
    const ageDays = this.ageInDays(referenceDate, now).toFixed(0);

    if (this.isWithinGracePeriod(referenceDate, now)) {
      return notWaste(
        pipeline.lastExecutionAt
          ? `last execution ${ageDays}d ago`
          : `created less than ${this.minAgeDays}d ago`,
      );
    }

    return waste(
      pipeline.lastExecutionAt ? `no execution in ${ageDays}d` : `never executed, created ${ageDays}d ago`,
    );
  }
}
