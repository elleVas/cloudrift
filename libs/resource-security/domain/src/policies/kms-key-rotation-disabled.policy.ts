// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { KmsKeyRotationDisabled } from '../entities/kms-key-rotation-disabled.entity';

/** The scanner only emits customer-managed symmetric keys with rotation disabled — always flagged once emitted. */
export class KmsKeyRotationDisabledPolicy extends ResourceSecurityPolicy<KmsKeyRotationDisabled> {
  protected judge(resource: KmsKeyRotationDisabled): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
