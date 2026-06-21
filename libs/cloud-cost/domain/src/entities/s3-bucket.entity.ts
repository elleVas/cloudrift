import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface S3BucketProps {
  bucketName: string;
  region: AwsRegion;
  accountId: string;
  sizeBytes: number;
  hasLifecyclePolicy: boolean;
  creationDate: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  /** Stima euristica del risparmio mensile abilitando una lifecycle policy. */
  monthlyCostUsd: number;
}

/**
 * Bucket S3 senza alcuna lifecycle policy configurata. Categoria
 * `optimization` + `estimated: true`: non sappiamo quanta parte dei dati sia
 * realmente "fredda", quindi il risparmio è una stima euristica da verificare,
 * non un valore certo come per `ebs-gp2-upgrade`.
 */
export class S3Bucket extends Entity<string> implements WastedResource {
  private readonly props: Readonly<S3BucketProps>;

  constructor(props: S3BucketProps) {
    super(props.bucketName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get sizeBytes(): number { return this.props.sizeBytes; }
  get creationDate(): Date { return this.props.creationDate; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 's3-no-lifecycle' { return 's3-no-lifecycle'; }
  get wasteReason(): string { return 'no lifecycle policy configured'; }

  hasLifecyclePolicy(): boolean {
    return this.props.hasLifecyclePolicy;
  }

  get costEstimate(): CostEstimate {
    const sizeGb = (this.props.sizeBytes / 1024 ** 3).toFixed(2);
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${sizeGb} GB without lifecycle policy (estimated saving)`,
    );
  }
}
