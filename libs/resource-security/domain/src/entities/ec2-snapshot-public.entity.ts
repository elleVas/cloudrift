// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface Ec2SnapshotPublicProps {
  snapshotId: string;
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** EBS snapshot with `createVolumePermission` granted to the `all` group — anyone can create a volume from it, exposing its data. */
export class Ec2SnapshotPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<Ec2SnapshotPublicProps>;

  constructor(props: Ec2SnapshotPublicProps) {
    super(props.snapshotId);
    this.props = this.deepFreeze({ ...props });
  }

  get volumeId(): string {
    return this.props.volumeId;
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

  get kind(): 'ec2-snapshot-public' {
    return 'ec2-snapshot-public';
  }

  get riskReason(): string {
    return 'snapshot has public restore permissions (createVolumePermission: all)';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
