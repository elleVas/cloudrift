// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { EksNodeOverprovisioned } from '../entities/eks-node-overprovisioned.entity';

export class EksNodeOverprovisionedPolicy extends WastePolicy<EksNodeOverprovisioned> {
  /** cpuUtilizationPercent: CPU-requested-to-allocatable ratio (%) below which a node group is "overprovisioned". Default 30. */
  constructor(options: WastePolicyOptions = {}, private readonly cpuUtilizationPercent = 30) {
    super(options);
  }

  protected judge(nodegroup: EksNodeOverprovisioned, now: Date): WasteVerdict {
    // No Container Insights datapoint is "no evidence" (likely not enabled
    // on the cluster), not "confirmed zero requests" — same reasoning as
    // AuroraServerlessOverprovisionedPolicy's hasDatapoint guard.
    if (!nodegroup.hasDatapoint) return notWaste('no Container Insights datapoint in window');
    if (nodegroup.cpuRequestedPercent >= this.cpuUtilizationPercent) {
      return notWaste('CPU requested above threshold');
    }
    if (nodegroup.suggestedNodeCount >= nodegroup.nodeCount) {
      return notWaste('no node count reduction available');
    }
    if (this.isWithinGracePeriod(nodegroup.nodegroupCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(
      `CPU requested ${nodegroup.cpuRequestedPercent.toFixed(1)}% of allocatable across ${nodegroup.nodeCount} node(s) over ${nodegroup.windowHours}h`,
    );
  }
}
