// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface RdsInstanceUnencryptedProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** RDS instance storage not encrypted at rest (`DescribeDBInstances`'s `StorageEncrypted: false`). */
export class RdsInstanceUnencrypted extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<RdsInstanceUnencryptedProps>;

  constructor(props: RdsInstanceUnencryptedProps) {
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

  get kind(): 'rds-instance-unencrypted' {
    return 'rds-instance-unencrypted';
  }

  get riskReason(): string {
    return 'RDS instance storage is not encrypted at rest';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
