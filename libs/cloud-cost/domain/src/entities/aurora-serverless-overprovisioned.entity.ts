// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

/**
 * Aurora Serverless v2 cluster whose configured **Min ACU** floor is far
 * above the real peak capacity observed over the window. Serverless v2 never
 * scales below Min ACU, so that floor is billed 730h/month regardless of load
 * — lowering it is a definite, always-on saving.
 *
 * Advisory (`estimated`): the saving assumes the floor keeps being billed at
 * the current Min ACU and that `suggestedMinAcu` still covers real peaks;
 * `monthlyCostUsd` here is the *saving* from lowering Min ACU, not the cost
 * of the cluster (same convention as {@link RdsUnderutilizedInstance}).
 */
export interface AuroraServerlessOverprovisionedProps {
  clusterIdentifier: string;
  region: AwsRegion;
  accountId: string;
  engine: string;
  minAcu: number;
  maxAcu: number;
  /** Maximum ServerlessDatabaseCapacity (ACU) observed over the window; 0 if `hasDatapoint` is false. */
  peakAcu: number;
  /**
   * Whether CloudWatch actually returned a datapoint for the window. `false`
   * means "no evidence", not "confirmed zero load" — the policy must not
   * treat it as an idle floor (unlike the zero-activity scanners, where a
   * missing datapoint legitimately means "no traffic").
   */
  hasDatapoint: boolean;
  /** Recommended Min ACU: peak + 20% margin, rounded up to AWS's 0.5 granularity. */
  suggestedMinAcu: number;
  windowHours: number;
  clusterCreateTime: Date;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class AuroraServerlessOverprovisioned extends Entity<string> implements WastedResource {
  private readonly props: Readonly<AuroraServerlessOverprovisionedProps>;

  constructor(props: AuroraServerlessOverprovisionedProps) {
    super(props.clusterIdentifier);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get engine(): string { return this.props.engine; }
  get minAcu(): number { return this.props.minAcu; }
  get maxAcu(): number { return this.props.maxAcu; }
  get peakAcu(): number { return this.props.peakAcu; }
  get hasDatapoint(): boolean { return this.props.hasDatapoint; }
  get suggestedMinAcu(): number { return this.props.suggestedMinAcu; }
  get windowHours(): number { return this.props.windowHours; }
  get clusterCreateTime(): Date { return this.props.clusterCreateTime; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'aurora-serverless-overprovisioned' { return 'aurora-serverless-overprovisioned'; }

  get wasteReason(): string {
    return `peak ${this.props.peakAcu.toFixed(2)} ACU vs Min ACU ${this.props.minAcu} over ${this.props.windowHours}h — lower Min ACU to ${this.props.suggestedMinAcu}`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `Aurora Serverless v2 ${this.props.engine} Min ACU ${this.props.minAcu}→${this.props.suggestedMinAcu} — estimated saving`,
    );
  }
}
