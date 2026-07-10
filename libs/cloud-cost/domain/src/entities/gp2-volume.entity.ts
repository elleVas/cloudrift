// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * gp2 EBS volume *attached and in use*, candidate for upgrade to gp3.
 * It is not waste to delete: it's a zero-cost optimization (gp3 has the
 * same performance baseline but costs less). `monthlyCostUsd` here
 * represents the monthly *saving*, not the cost of the resource.
 *
 * gp2 volumes that are *not* attached (state=available) are handled as waste
 * by the `ebs-volume` flow, so they are never counted twice.
 */
export interface Gp2VolumeProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  sizeGb: number;
  createTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  /** Estimated monthly saving from switching from gp2 to gp3, in USD. */
  monthlyCostUsd: number;
}

export class Gp2Volume extends Entity<string> implements WastedResource {
  private readonly props: Readonly<Gp2VolumeProps>;

  constructor(props: Gp2VolumeProps) {
    super(props.volumeId);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeGb(): number { return this.props.sizeGb; }
  get createTime(): Date { return this.props.createTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ebs-gp2-upgrade' { return 'ebs-gp2-upgrade'; }

  get wasteReason(): string {
    return `gp2 → gp3 saves $${this.props.monthlyCostUsd.toFixed(2)}/mo (same baseline performance)`;
  }

  get monthlySavingUsd(): number { return this.props.monthlyCostUsd; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.sizeGb} GB gp2 → gp3 saving`,
    );
  }
}
