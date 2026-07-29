// SPDX-License-Identifier: Apache-2.0
import { EventBridgeClient, ListRulesCommand, ListTargetsByRuleCommand, type Rule } from '@aws-sdk/client-eventbridge';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { EventbridgeRuleNoTargets, EventbridgeRuleNoTargetsPolicy } from 'dead-resources-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';

/** Bounds the per-rule ListTargetsByRule fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const TARGET_LOOKUP_CONCURRENCY = 5;

type RuleWithArn = Rule & { Arn: string; Name: string };

/**
 * Detects EventBridge rules with no targets configured. Only the account's
 * **default** event bus is scanned (`ListRules`'s `EventBusName` omitted) —
 * custom buses are a known gap, deferred until there's a demonstrated need
 * (same "prove the pattern first" reasoning ADR-0078 used for shipping one
 * kind before the other three). `ListRules` doesn't return tags inline, so
 * `tags` is always `{}`.
 */
export class AwsEventbridgeRuleNoTargetsScanner implements DeadResourceScannerPort {
  readonly kind = 'eventbridge-rule-no-targets' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new EventbridgeRuleNoTargetsPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new EventBridgeClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawRules = await paginate<Rule>(async (cursor) => {
        const r = await client.send(new ListRulesCommand({ NextToken: cursor }));
        return { items: r.Rules ?? [], cursor: r.NextToken };
      });
      const validRules = rawRules.filter((r): r is RuleWithArn => !!r.Arn && !!r.Name);

      const now = new Date();
      const candidates = await mapWithConcurrency(validRules, TARGET_LOOKUP_CONCURRENCY, async (rule) => {
        const targets = await paginate(async (cursor) => {
          const r = await client.send(new ListTargetsByRuleCommand({ Rule: rule.Name, NextToken: cursor }));
          return { items: r.Targets ?? [], cursor: r.NextToken };
        });
        if (targets.length > 0) return undefined;
        return new EventbridgeRuleNoTargets({
          ruleArn: rule.Arn,
          ruleName: rule.Name,
          region,
          accountId: this.accountId,
          detectedAt: now,
          tags: {},
        });
      });

      const results = candidates
        .filter((r): r is EventbridgeRuleNoTargets => r !== undefined)
        .filter((r) => this.policy.evaluate(r, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EventBridge', err));
    } finally {
      client.destroy();
    }
  }
}
