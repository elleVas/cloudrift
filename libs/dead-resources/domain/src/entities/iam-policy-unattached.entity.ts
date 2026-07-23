// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface IamPolicyUnattachedProps {
  policyId: string;
  policyName: string;
  arn: string;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Customer-managed IAM policy attached to no user, group, or role
 * (`AttachmentCount === 0`). AWS-managed policies are excluded server-side
 * by the scanner (`Scope: 'Local'`) — nothing to clean up there, the user
 * doesn't own them. IAM is a global AWS service — no `region` (ADR-0078).
 */
export class IamPolicyUnattached extends Entity<string> implements DeadResource {
  private readonly props: Readonly<IamPolicyUnattachedProps>;

  constructor(props: IamPolicyUnattachedProps) {
    super(props.policyId);
    this.props = this.deepFreeze({ ...props });
  }

  get policyName(): string {
    return this.props.policyName;
  }

  get arn(): string {
    return this.props.arn;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-policy-unattached' {
    return 'iam-policy-unattached';
  }

  get hygieneReason(): string {
    return 'not attached to any user, group, or role';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
