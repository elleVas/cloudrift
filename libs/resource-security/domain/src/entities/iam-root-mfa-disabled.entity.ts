// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface IamRootMfaDisabledProps {
  accountId: string;
  mfaEnabled: boolean;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Account-wide finding (at most one per account): the root user has no MFA
 * device enrolled. From `iam:GetAccountSummary`'s `AccountMFAEnabled` field
 * — no per-resource identity to key on, so `id` is the account id.
 */
export class IamRootMfaDisabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<IamRootMfaDisabledProps>;

  constructor(props: IamRootMfaDisabledProps) {
    super(props.accountId);
    this.props = this.deepFreeze({ ...props });
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get mfaEnabled(): boolean {
    return this.props.mfaEnabled;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-root-mfa-disabled' {
    return 'iam-root-mfa-disabled';
  }

  get riskReason(): string {
    return 'root account has no MFA device enabled';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
