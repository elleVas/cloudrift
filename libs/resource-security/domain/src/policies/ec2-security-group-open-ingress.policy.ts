// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { Ec2SecurityGroupOpenIngress } from '../entities/ec2-security-group-open-ingress.entity';

/** The scanner only emits security groups that already have a matched sensitive-port rule. */
export class Ec2SecurityGroupOpenIngressPolicy extends ResourceSecurityPolicy<Ec2SecurityGroupOpenIngress> {
  protected judge(resource: Ec2SecurityGroupOpenIngress): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
