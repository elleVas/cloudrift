// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface IamAccessKeyStaleProps {
  accessKeyId: string;
  userName: string;
  status: 'Active' | 'Inactive';
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Active IAM access key not rotated within the policy's age threshold — the
 * CIS AWS Foundations Benchmark's own "access keys should be rotated"
 * control. Access keys aren't taggable AWS resources, so `tags` is always
 * `{}` (the `ignoreTag`/`excludeTagValues` policy exclusions are inert for
 * this kind — no per-key opt-out is possible via tags). IAM is a global AWS
 * service — no `region` (ADR-0078).
 */
export class IamAccessKeyStale extends Entity<string> implements DeadResource {
  private readonly props: Readonly<IamAccessKeyStaleProps>;

  constructor(props: IamAccessKeyStaleProps) {
    super(props.accessKeyId);
    this.props = this.deepFreeze({ ...props });
  }

  get userName(): string {
    return this.props.userName;
  }

  get status(): 'Active' | 'Inactive' {
    return this.props.status;
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

  get kind(): 'iam-access-key-stale' {
    return 'iam-access-key-stale';
  }

  get hygieneReason(): string {
    return `not rotated since ${this.createdAt.toISOString().split('T')[0]}`;
  }

  get severity(): DeadResourceSeverity {
    return 'warning';
  }
}
