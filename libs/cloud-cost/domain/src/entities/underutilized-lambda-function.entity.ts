import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface UnderutilizedLambdaFunctionProps {
  functionName: string;
  region: AwsRegion;
  accountId: string;
  memorySizeMb: number;
  invocationsLastWindow: number;
  windowDays: number;
  lastModified: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Lambda function with (near) zero invocations over the observed window.
 * Lambda is pay-per-use: an inactive function generates no direct cost
 * (unlike Provisioned Concurrency, not detected here), so the
 * value of the finding is hygiene/cleanup, not a saving in dollars — same
 * principle as `eni-orphaned`. We do not estimate a possible memory
 * rightsizing: it would require Lambda Insights, not available via plain Describe*.
 */
export class UnderutilizedLambdaFunction extends Entity<string> implements WastedResource {
  private readonly props: Readonly<UnderutilizedLambdaFunctionProps>;

  constructor(props: UnderutilizedLambdaFunctionProps) {
    super(props.functionName);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get memorySizeMb(): number { return this.props.memorySizeMb; }
  get invocationsLastWindow(): number { return this.props.invocationsLastWindow; }
  get windowDays(): number { return this.props.windowDays; }
  get lastModified(): Date { return this.props.lastModified; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'lambda-underutilized' { return 'lambda-underutilized'; }
  get wasteReason(): string {
    return `${this.props.invocationsLastWindow} invocations over ${this.props.windowDays}d`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(0, 'Underutilized Lambda function (hygiene flag, no direct cost)');
  }
}
