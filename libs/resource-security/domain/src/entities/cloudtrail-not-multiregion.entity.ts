// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface CloudtrailNotMultiregionProps {
  accountId: string;
  hasMultiRegionTrail: boolean;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * Account-wide finding: no CloudTrail trail is configured with
 * `IsMultiRegionTrail: true`. CIS AWS Foundations 3.1 — without one,
 * activity in regions with no dedicated trail goes unlogged.
 */
export class CloudtrailNotMultiregion extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<CloudtrailNotMultiregionProps>;

  constructor(props: CloudtrailNotMultiregionProps) {
    super(props.accountId);
    this.props = this.deepFreeze({ ...props });
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get hasMultiRegionTrail(): boolean {
    return this.props.hasMultiRegionTrail;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'cloudtrail-not-multiregion' {
    return 'cloudtrail-not-multiregion';
  }

  get riskReason(): string {
    return 'no CloudTrail trail is configured for multi-region logging';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
