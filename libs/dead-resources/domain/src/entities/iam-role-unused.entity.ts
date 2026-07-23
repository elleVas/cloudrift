// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface IamRoleUnusedProps {
  roleId: string;
  roleName: string;
  arn: string;
  accountId: string;
  createdAt: Date;
  /** From `RoleLastUsed.LastUsedDate`; undefined if the role has never been assumed. */
  lastUsedAt: Date | undefined;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * IAM role never assumed, or not assumed within the policy's inactivity
 * window. Service-linked roles (`/aws-service-role/...` path) are excluded
 * by the scanner — the account doesn't own their lifecycle. IAM is a global
 * AWS service — no `region` (ADR-0078).
 */
export class IamRoleUnused extends Entity<string> implements DeadResource {
  private readonly props: Readonly<IamRoleUnusedProps>;

  constructor(props: IamRoleUnusedProps) {
    super(props.roleId);
    this.props = this.deepFreeze({ ...props });
  }

  get roleName(): string {
    return this.props.roleName;
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

  get lastUsedAt(): Date | undefined {
    return this.props.lastUsedAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-role-unused' {
    return 'iam-role-unused';
  }

  get hygieneReason(): string {
    return this.lastUsedAt === undefined
      ? 'never assumed since creation'
      : `not assumed since ${this.lastUsedAt.toISOString().split('T')[0]}`;
  }

  get severity(): DeadResourceSeverity {
    return 'warning';
  }
}
