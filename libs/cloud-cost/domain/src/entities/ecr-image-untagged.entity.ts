// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface EcrImageUntaggedProps {
  imageDigest: string;
  region: AwsRegion;
  accountId: string;
  repositoryName: string;
  sizeBytes: number;
  imagePushedAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class EcrImageUntagged extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EcrImageUntaggedProps>;

  constructor(props: EcrImageUntaggedProps) {
    super(props.imageDigest);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get repositoryName(): string { return this.props.repositoryName; }
  get sizeBytes(): number { return this.props.sizeBytes; }
  get imagePushedAt(): Date { return this.props.imagePushedAt; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'ecr-image-untagged' { return 'ecr-image-untagged'; }
  get wasteReason(): string { return 'no image tag, not pullable by tag'; }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${(this.props.sizeBytes / 1024 ** 3).toFixed(2)} GB untagged image`,
    );
  }
}
