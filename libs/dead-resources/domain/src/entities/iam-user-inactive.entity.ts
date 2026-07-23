// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface IamUserInactiveProps {
  userId: string;
  userName: string;
  arn: string;
  accountId: string;
  createdAt: Date;
  /** Latest of password-login and access-key usage; undefined if the user has never authenticated at all. */
  lastActivityAt: Date | undefined;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * IAM user with no console login or access-key usage in the policy's
 * `inactivityDays` window (or ever). IAM is a global AWS service — no
 * `region` (see `DeadResource.region` and ADR-0078).
 */
export class IamUserInactive extends Entity<string> implements DeadResource {
  private readonly props: Readonly<IamUserInactiveProps>;

  constructor(props: IamUserInactiveProps) {
    super(props.userId);
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

  get lastActivityAt(): Date | undefined {
    return this.props.lastActivityAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-user-inactive' {
    return 'iam-user-inactive';
  }

  get hygieneReason(): string {
    return this.lastActivityAt === undefined
      ? 'never used since creation'
      : `no activity since ${this.lastActivityAt.toISOString().split('T')[0]}`;
  }

  get severity(): DeadResourceSeverity {
    return 'warning';
  }
}
