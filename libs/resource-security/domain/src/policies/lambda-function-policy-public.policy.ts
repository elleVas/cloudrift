// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { LambdaFunctionPolicyPublic } from '../entities/lambda-function-policy-public.entity';

/** The scanner only emits functions whose resource policy already grants public access — always flagged once emitted. */
export class LambdaFunctionPolicyPublicPolicy extends ResourceSecurityPolicy<LambdaFunctionPolicyPublic> {
  protected judge(resource: LambdaFunctionPolicyPublic): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
