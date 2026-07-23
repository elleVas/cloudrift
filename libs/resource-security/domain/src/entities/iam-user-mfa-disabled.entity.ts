// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface IamUserMfaDisabledProps {
  userName: string;
  arn: string;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** IAM user with no MFA device registered (`iam:ListMFADevices` returns empty). IAM is a global AWS service — no `region`. */
export class IamUserMfaDisabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<IamUserMfaDisabledProps>;

  constructor(props: IamUserMfaDisabledProps) {
    super(props.arn);
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

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-user-mfa-disabled' {
    return 'iam-user-mfa-disabled';
  }

  get riskReason(): string {
    return 'no MFA device registered';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
