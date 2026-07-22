// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { AuroraServerlessOverprovisioned } from '../entities/aurora-serverless-overprovisioned.entity';

export class AuroraServerlessOverprovisionedPolicy extends WastePolicy<AuroraServerlessOverprovisioned> {
  /** minAcuUtilizationPercent: peak-to-Min-ACU ratio (%) below which the floor is "overprovisioned". Default 50. */
  constructor(options: WastePolicyOptions = {}, private readonly minAcuUtilizationPercent = 50) {
    super(options);
  }

  protected judge(cluster: AuroraServerlessOverprovisioned, now: Date): WasteVerdict {
    // A missing datapoint is "no evidence", not "confirmed zero load" — unlike
    // the zero-activity scanners, flagging on it would recommend slashing
    // Min ACU off a metric CloudWatch never actually reported.
    if (!cluster.hasDatapoint) return notWaste('no ServerlessDatabaseCapacity datapoint in window');
    if (cluster.peakAcu >= cluster.minAcu * (this.minAcuUtilizationPercent / 100)) {
      return notWaste('peak ACU above threshold');
    }
    // After rounding the suggestion up to AWS's 0.5 ACU granularity there may
    // be nothing left to lower (e.g. Min ACU already at the 0.5 floor).
    if (cluster.suggestedMinAcu >= cluster.minAcu) {
      return notWaste('no Min ACU reduction available');
    }
    // A just-created cluster might not have reached its real peak load yet.
    if (this.isWithinGracePeriod(cluster.clusterCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`peak ${cluster.peakAcu.toFixed(2)} ACU / Min ACU ${cluster.minAcu} over ${cluster.windowHours}h`);
  }
}
