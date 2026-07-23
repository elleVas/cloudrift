// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { Ec2DefaultSecurityGroupPermissive } from '../entities/ec2-default-security-group-permissive.entity';

/** The scanner only emits default security groups that already carry at least one rule. */
export class Ec2DefaultSecurityGroupPermissivePolicy extends ResourceSecurityPolicy<Ec2DefaultSecurityGroupPermissive> {
  protected judge(resource: Ec2DefaultSecurityGroupPermissive): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
