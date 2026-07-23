// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { Ec2SnapshotPublic } from '../entities/ec2-snapshot-public.entity';

/** The scanner only emits snapshots already confirmed public via `DescribeSnapshotAttribute`. */
export class Ec2SnapshotPublicPolicy extends ResourceSecurityPolicy<Ec2SnapshotPublic> {
  protected judge(resource: Ec2SnapshotPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
