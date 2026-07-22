// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { UnderutilizedLambdaFunction } from '../entities/underutilized-lambda-function.entity';

export class LambdaUnderutilizedPolicy extends WastePolicy<UnderutilizedLambdaFunction> {
  /** maxInvocations: maximum invocations threshold below which the function is underutilized. */
  constructor(options: WastePolicyOptions = {}, private readonly maxInvocations = 0) {
    super(options);
  }

  protected judge(fn: UnderutilizedLambdaFunction, now: Date): WasteVerdict {
    if (fn.invocationsLastWindow > this.maxInvocations) return notWaste('invocations above threshold');
    // A just-deployed function might not have received real traffic yet.
    if (this.isWithinGracePeriod(fn.lastModified, now)) {
      return notWaste(`last modified less than ${this.minAgeDays}d ago`);
    }
    return waste(`${fn.invocationsLastWindow} invocations over ${fn.windowDays}d`);
  }
}
