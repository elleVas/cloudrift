// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface RedshiftClusterPubliclyAccessibleProps {
  clusterId: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** Redshift cluster reachable from the internet (`PubliclyAccessible: true`) — the Redshift analog of `rds-instance-publicly-accessible`. */
export class RedshiftClusterPubliclyAccessible extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<RedshiftClusterPubliclyAccessibleProps>;

  constructor(props: RedshiftClusterPubliclyAccessibleProps) {
    super(props.clusterId);
    this.props = this.deepFreeze({ ...props });
  }

  get clusterId(): string {
    return this.props.clusterId;
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

  get kind(): 'redshift-cluster-publicly-accessible' {
    return 'redshift-cluster-publicly-accessible';
  }

  get riskReason(): string {
    return 'Redshift cluster is publicly accessible';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
