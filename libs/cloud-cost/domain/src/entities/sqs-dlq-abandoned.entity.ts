// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface SqsDlqAbandonedProps {
  queueUrl: string;
  queueName: string;
  approximateNumberOfMessages: number;
  oldestMessageAgeSeconds: number;
  /** Set by the scanner: RedriveAllowPolicy present, ARN referenced by another queue's RedrivePolicy, or name matches a DLQ naming convention. */
  identifiedAsDlq: boolean;
  sourceQueueArn?: string;
  region: AwsRegion;
  accountId: string;
  tags: Record<string, string>;
}

/**
 * SQS queue identified as a Dead Letter Queue (via RedrivePolicy/RedriveAllowPolicy
 * or naming convention) holding messages older than the policy's grace period.
 * SQS has no storage cost: the finding is a hygiene flag (errors nobody is
 * looking at), not a direct saving — same reasoning as OrphanedEni.
 */
export class SqsDlqAbandoned extends Entity<string> implements WastedResource {
  private readonly props: Readonly<SqsDlqAbandonedProps>;

  constructor(props: SqsDlqAbandonedProps) {
    super(props.queueUrl);
    this.props = this.deepFreeze({ ...props });
  }

  get queueUrl(): string { return this.props.queueUrl; }
  get queueName(): string { return this.props.queueName; }
  get approximateNumberOfMessages(): number { return this.props.approximateNumberOfMessages; }
  get oldestMessageAgeSeconds(): number { return this.props.oldestMessageAgeSeconds; }
  get identifiedAsDlq(): boolean { return this.props.identifiedAsDlq; }
  get sourceQueueArn(): string | undefined { return this.props.sourceQueueArn; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get tags(): Record<string, string> { return this.props.tags; }

  get detectedAt(): Date { return new Date(Date.now() - this.props.oldestMessageAgeSeconds * 1000); }
  get kind(): 'sqs-dlq-abandoned' { return 'sqs-dlq-abandoned'; }
  get wasteReason(): string {
    const days = Math.floor(this.props.oldestMessageAgeSeconds / 86400);
    return `oldest message ${days}d old, ${this.props.approximateNumberOfMessages} message(s) unconsumed`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(0, 'Abandoned SQS DLQ (hygiene flag, no storage cost)');
  }
}
