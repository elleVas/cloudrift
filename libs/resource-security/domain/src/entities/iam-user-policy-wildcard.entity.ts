// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface IamUserPolicyWildcardProps {
  userName: string;
  arn: string;
  accountId: string;
  /** Name of the first offending policy found (inline or managed) — enough to point the user at it. */
  policyName: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** IAM user with an attached (inline or managed) policy granting `Action: "*"` on `Resource: "*"` — full admin, directly on a user rather than via a role. */
export class IamUserPolicyWildcard extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<IamUserPolicyWildcardProps>;

  constructor(props: IamUserPolicyWildcardProps) {
    super(props.userName);
    this.props = this.deepFreeze({ ...props });
  }

  get userName(): string {
    return this.props.userName;
  }

  get arn(): string {
    return this.props.arn;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get policyName(): string {
    return this.props.policyName;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-user-policy-wildcard' {
    return 'iam-user-policy-wildcard';
  }

  get riskReason(): string {
    return `policy "${this.policyName}" grants full admin access (Action: "*", Resource: "*") directly to this user`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
