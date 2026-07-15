// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface EksOrphanPvcProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  pvcName: string;
  pvcNamespace: string;
  /**
   * Owning cluster, recovered from the `kubernetes.io/cluster/<name>` tag
   * (legacy in-tree provisioner convention — CSI-driver-provisioned volumes
   * without `--extra-tags` won't carry it). Undefined means "no evidence
   * either way", not "no cluster" — see ADR-0066.
   */
  clusterName?: string;
  /** Whether `clusterName` still appears in `eks:ListClusters`. `true` when `clusterName` is undefined. */
  clusterExists: boolean;
  sizeGb: number;
  volumeType: string;
  state: string;
  createdTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

/**
 * EBS volume provisioned for a Kubernetes PersistentVolumeClaim on EKS
 * (identified via the CSI driver's `kubernetes.io/created-for/pvc/name` tag)
 * that is either unattached, or still tagged for a cluster that no longer
 * exists. AWS-API-only, no kubeconfig — see ADR-0066.
 */
export class EksOrphanPvc extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EksOrphanPvcProps>;

  constructor(props: EksOrphanPvcProps) {
    super(props.volumeId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get pvcName(): string { return this.props.pvcName; }
  get pvcNamespace(): string { return this.props.pvcNamespace; }
  get clusterName(): string | undefined { return this.props.clusterName; }
  get clusterExists(): boolean { return this.props.clusterExists; }
  get sizeGb(): number { return this.props.sizeGb; }
  get volumeType(): string { return this.props.volumeType; }
  get state(): string { return this.props.state; }
  get createdTime(): Date { return this.props.createdTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'eks-orphan-pvc' { return 'eks-orphan-pvc'; }

  isUnattached(): boolean {
    return this.props.state === 'available';
  }

  get isOrphanedByMissingCluster(): boolean {
    return this.props.clusterName !== undefined && !this.props.clusterExists;
  }

  get wasteReason(): string {
    return this.isOrphanedByMissingCluster
      ? `owning EKS cluster "${this.props.clusterName}" no longer exists`
      : 'unattached (Kubernetes PVC volume, no Pod using it)';
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB ${this.props.volumeType} orphaned Kubernetes PVC volume (${this.props.pvcNamespace}/${this.props.pvcName})`,
    );
  }
}
