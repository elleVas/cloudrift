// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface Ec2VolumeUnencryptedProps {
  volumeId: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** EBS volume not encrypted at rest (`DescribeVolumes`'s `Encrypted: false`). */
export class Ec2VolumeUnencrypted extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<Ec2VolumeUnencryptedProps>;

  constructor(props: Ec2VolumeUnencryptedProps) {
    super(props.volumeId);
    this.props = this.deepFreeze({ ...props });
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

  get kind(): 'ec2-volume-unencrypted' {
    return 'ec2-volume-unencrypted';
  }

  get riskReason(): string {
    return 'EBS volume is not encrypted at rest';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
