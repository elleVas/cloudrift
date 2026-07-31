// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface SqsQueuePolicyPublicProps {
  queueUrl: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** SQS queue with an access policy that grants send/receive to anyone (`Principal: "*"`, no restricting condition). */
export class SqsQueuePolicyPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<SqsQueuePolicyPublicProps>;

  constructor(props: SqsQueuePolicyPublicProps) {
    super(props.queueUrl);
    this.props = this.deepFreeze({ ...props });
  }

  get queueUrl(): string {
    return this.props.queueUrl;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'sqs-queue-policy-public' {
    return 'sqs-queue-policy-public';
  }

  get riskReason(): string {
    return 'access policy grants access to any AWS principal';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
