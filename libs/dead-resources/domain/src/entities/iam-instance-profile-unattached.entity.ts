// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface IamInstanceProfileUnattachedProps {
  instanceProfileId: string;
  instanceProfileName: string;
  arn: string;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * IAM instance profile not referenced by any EC2 instance's
 * `IamInstanceProfile.Arn` — checked account-wide, across every enabled AWS
 * region, not just the regions the CLI's `--regions` flag requested (see
 * `AwsIamInstanceProfileUnattachedScanner`'s doc comment for why: an
 * instance profile is a global IAM object that can be attached to an
 * instance in *any* region, so a `--regions`-scoped check would risk false
 * positives). IAM is a global AWS service — no `region` (ADR-0078).
 */
export class IamInstanceProfileUnattached extends Entity<string> implements DeadResource {
  private readonly props: Readonly<IamInstanceProfileUnattachedProps>;

  constructor(props: IamInstanceProfileUnattachedProps) {
    super(props.instanceProfileId);
    this.props = this.deepFreeze({ ...props });
  }

  get instanceProfileName(): string {
    return this.props.instanceProfileName;
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

  get kind(): 'iam-instance-profile-unattached' {
    return 'iam-instance-profile-unattached';
  }

  get hygieneReason(): string {
    return 'not attached to any EC2 instance in any AWS region';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
