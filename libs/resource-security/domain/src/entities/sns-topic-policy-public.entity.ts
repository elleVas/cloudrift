// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface SnsTopicPolicyPublicProps {
  topicArn: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** SNS topic with an access policy that grants publish/subscribe to anyone (`Principal: "*"`, no restricting condition). */
export class SnsTopicPolicyPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<SnsTopicPolicyPublicProps>;

  constructor(props: SnsTopicPolicyPublicProps) {
    super(props.topicArn);
    this.props = this.deepFreeze({ ...props });
  }

  get topicArn(): string {
    return this.props.topicArn;
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

  get kind(): 'sns-topic-policy-public' {
    return 'sns-topic-policy-public';
  }

  get riskReason(): string {
    return 'access policy grants access to any AWS principal';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
