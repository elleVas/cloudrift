// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface KmsKeyRotationDisabledProps {
  keyId: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** Customer-managed symmetric KMS key with automatic key rotation disabled (CIS AWS Foundations 3.8). */
export class KmsKeyRotationDisabled extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<KmsKeyRotationDisabledProps>;

  constructor(props: KmsKeyRotationDisabledProps) {
    super(props.keyId);
    this.props = this.deepFreeze({ ...props });
  }

  get keyId(): string {
    return this.props.keyId;
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

  get kind(): 'kms-key-rotation-disabled' {
    return 'kms-key-rotation-disabled';
  }

  get riskReason(): string {
    return 'automatic key rotation is disabled';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
