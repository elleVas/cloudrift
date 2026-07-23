// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface RdsInstancePubliclyAccessibleProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** RDS instance reachable from outside its VPC (`DescribeDBInstances`'s `PubliclyAccessible: true`). */
export class RdsInstancePubliclyAccessible extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<RdsInstancePubliclyAccessibleProps>;

  constructor(props: RdsInstancePubliclyAccessibleProps) {
    super(props.dbInstanceIdentifier);
    this.props = this.deepFreeze({ ...props });
  }

  get dbInstanceIdentifier(): string {
    return this.props.dbInstanceIdentifier;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'rds-instance-publicly-accessible' {
    return 'rds-instance-publicly-accessible';
  }

  get riskReason(): string {
    return 'RDS instance is publicly accessible';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
