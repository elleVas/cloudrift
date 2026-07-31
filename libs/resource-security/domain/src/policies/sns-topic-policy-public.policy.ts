// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { SnsTopicPolicyPublic } from '../entities/sns-topic-policy-public.entity';

/** The scanner only emits topics whose access policy already grants public access — always flagged once emitted. */
export class SnsTopicPolicyPublicPolicy extends ResourceSecurityPolicy<SnsTopicPolicyPublic> {
  protected judge(resource: SnsTopicPolicyPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
