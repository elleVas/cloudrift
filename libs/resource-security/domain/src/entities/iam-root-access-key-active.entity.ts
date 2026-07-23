// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface IamRootAccessKeyActiveProps {
  accountId: string;
  accessKeysPresent: boolean;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Account-wide finding: the root user has at least one active access key.
 * From `iam:GetAccountSummary`'s `AccountAccessKeysPresent` field — CIS AWS
 * Foundations 1.4 recommends the root user have no access keys at all.
 */
export class IamRootAccessKeyActive extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<IamRootAccessKeyActiveProps>;

  constructor(props: IamRootAccessKeyActiveProps) {
    super(props.accountId);
    this.props = this.deepFreeze({ ...props });
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get accessKeysPresent(): boolean {
    return this.props.accessKeysPresent;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-root-access-key-active' {
    return 'iam-root-access-key-active';
  }

  get riskReason(): string {
    return 'root account has at least one active access key';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
