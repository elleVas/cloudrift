// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { SecretsManagerSecretPolicyPublic } from '../entities/secrets-manager-secret-policy-public.entity';

/** The scanner only emits secrets whose resource policy already grants public access — always flagged once emitted. */
export class SecretsManagerSecretPolicyPublicPolicy extends ResourceSecurityPolicy<SecretsManagerSecretPolicyPublic> {
  protected judge(resource: SecretsManagerSecretPolicyPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
