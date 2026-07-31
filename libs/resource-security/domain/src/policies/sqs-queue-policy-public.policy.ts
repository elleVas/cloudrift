// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { SqsQueuePolicyPublic } from '../entities/sqs-queue-policy-public.entity';

/** The scanner only emits queues whose access policy already grants public access — always flagged once emitted. */
export class SqsQueuePolicyPublicPolicy extends ResourceSecurityPolicy<SqsQueuePolicyPublic> {
  protected judge(resource: SqsQueuePolicyPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
