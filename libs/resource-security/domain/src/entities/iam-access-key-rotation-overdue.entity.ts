// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface IamAccessKeyRotationOverdueProps {
  accessKeyId: string;
  userName: string;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Active IAM access key older than the policy's rotation window. Distinct
 * from `dead-resources-domain`'s `iam-access-key-stale` (an age-based
 * hygiene heuristic): this is framed as a security-policy violation (CIS AWS
 * Foundations 1.14: rotate access keys every 90 days), same underlying
 * `iam:ListAccessKeys` data, different lens.
 */
export class IamAccessKeyRotationOverdue extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<IamAccessKeyRotationOverdueProps>;

  constructor(props: IamAccessKeyRotationOverdueProps) {
    super(props.accessKeyId);
    this.props = this.deepFreeze({ ...props });
  }

  get accessKeyId(): string {
    return this.props.accessKeyId;
  }

  get userName(): string {
    return this.props.userName;
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

  get kind(): 'iam-access-key-rotation-overdue' {
    return 'iam-access-key-rotation-overdue';
  }

  get riskReason(): string {
    const ageDays = Math.floor((this.detectedAt.getTime() - this.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    return `active for ${ageDays}d, exceeds the rotation policy`;
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
