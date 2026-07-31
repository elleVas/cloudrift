// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { EcrRepositoryPolicyPublic } from '../entities/ecr-repository-policy-public.entity';

/** The scanner only emits repositories whose repository policy already grants public access — always flagged once emitted. */
export class EcrRepositoryPolicyPublicPolicy extends ResourceSecurityPolicy<EcrRepositoryPolicyPublic> {
  protected judge(resource: EcrRepositoryPolicyPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
