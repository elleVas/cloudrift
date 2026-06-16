import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * Volume EBS gp2 *attaccato e in uso*, candidato all'upgrade a gp3.
 * Non è spreco da cancellare: è un'ottimizzazione a costo zero (gp3 ha lo
 * stesso baseline di performance ma costa meno). `monthlyCostUsd` qui
 * rappresenta il *risparmio* mensile, non il costo della risorsa.
 *
 * I volumi gp2 *non* attaccati (state=available) sono gestiti come spreco
 * dal flusso `ebs-volume`, quindi non vengono mai conteggiati due volte.
 */
export interface Gp2VolumeProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  sizeGb: number;
  createTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  /** Risparmio mensile stimato passando da gp2 a gp3, in USD. */
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
