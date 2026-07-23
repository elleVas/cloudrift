// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface EventbridgeRuleNoTargetsProps {
  ruleArn: string;
  ruleName: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * EventBridge rule with no targets configured — it can match events all day
 * and nothing will ever happen. Only the default event bus is scanned (see
 * `AwsEventbridgeRuleNoTargetsScanner`'s doc comment); custom buses are a
 * known gap. No `createdAt`: `ListRules` doesn't expose a creation
 * timestamp, so this kind's policy skips the shared grace-period machinery,
 * same reasoning as `Ec2SecurityGroupUnused`. `ListRules` doesn't return
 * tags inline, so `tags` is always `{}`.
 */
export class EventbridgeRuleNoTargets extends Entity<string> implements DeadResource {
  private readonly props: Readonly<EventbridgeRuleNoTargetsProps>;

  constructor(props: EventbridgeRuleNoTargetsProps) {
    super(props.ruleArn);
    this.props = this.deepFreeze({ ...props });
  }

  get ruleName(): string {
    return this.props.ruleName;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'eventbridge-rule-no-targets' {
    return 'eventbridge-rule-no-targets';
  }

  get hygieneReason(): string {
    return 'has no targets configured';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
