// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { Ec2VolumeUnencrypted } from '../entities/ec2-volume-unencrypted.entity';

/** The scanner only emits volumes already confirmed unencrypted. */
export class Ec2VolumeUnencryptedPolicy extends ResourceSecurityPolicy<Ec2VolumeUnencrypted> {
  protected judge(resource: Ec2VolumeUnencrypted): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
