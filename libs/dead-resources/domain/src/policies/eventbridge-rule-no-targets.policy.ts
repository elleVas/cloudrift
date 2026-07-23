// SPDX-License-Identifier: Apache-2.0
import { DeadResourcePolicy, flagged, type HygieneVerdict } from './dead-resource-policy';
import type { EventbridgeRuleNoTargets } from '../entities/eventbridge-rule-no-targets.entity';

/**
 * No grace-period machinery: `EventbridgeRuleNoTargets` has no `createdAt`
 * (`ListRules` doesn't expose one), same reasoning as
 * `Ec2SecurityGroupUnusedPolicy`.
 */
export class EventbridgeRuleNoTargetsPolicy extends DeadResourcePolicy<EventbridgeRuleNoTargets> {
  protected judge(resource: EventbridgeRuleNoTargets): HygieneVerdict {
    return flagged(resource.hygieneReason);
  }
}
