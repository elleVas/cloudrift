// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { EksOrphanPvc } from '../entities/eks-orphan-pvc.entity';

export class EksOrphanPvcPolicy extends WastePolicy<EksOrphanPvc> {
  protected judge(volume: EksOrphanPvc, now: Date): WasteVerdict {
    const orphanedByMissingCluster = volume.isOrphanedByMissingCluster;
    if (!volume.isUnattached() && !orphanedByMissingCluster) {
      return notWaste('attached and owning cluster still exists (or unknown)');
    }
    if (this.isWithinGracePeriod(volume.createdTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return orphanedByMissingCluster
      ? waste(`owning EKS cluster "${volume.clusterName}" no longer exists`)
      : waste('unattached (Kubernetes PVC volume, no Pod using it)');
  }
}
