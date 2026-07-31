// SPDX-License-Identifier: Apache-2.0
import { SNSClient, ListTopicsCommand, GetTopicAttributesCommand, type Topic } from '@aws-sdk/client-sns';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { SnsTopicPolicyPublic, SnsTopicPolicyPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig, parsePolicyStatements, isWildcardPrincipal } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-topic `GetTopicAttributes` calls in flight at once. */
const TOPIC_CHECK_CONCURRENCY = 8;

type TopicWithArn = Topic & { TopicArn: string };

function isPublicPolicy(policyJson: string | undefined): boolean {
  return parsePolicyStatements(policyJson).some((s) => s.Effect === 'Allow' && isWildcardPrincipal(s.Principal) && s.Condition === undefined);
}

/** Detects SNS topics with an access policy granting access to any AWS principal, with no restricting condition. */
export class AwsSnsTopicPolicyPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 'sns-topic-policy-public' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new SnsTopicPolicyPublicPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new SNSClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawTopics = await paginate<Topic>(async (cursor) => {
        const r = await client.send(new ListTopicsCommand({ NextToken: cursor }));
        return { items: r.Topics ?? [], cursor: r.NextToken };
      });
      const validTopics = rawTopics.filter((t): t is TopicWithArn => !!t.TopicArn);
      const now = new Date();

      const candidates = await mapWithConcurrency(validTopics, TOPIC_CHECK_CONCURRENCY, async (topic) => {
        try {
          const { Attributes } = await client.send(new GetTopicAttributesCommand({ TopicArn: topic.TopicArn }));
          if (!isPublicPolicy(Attributes?.Policy)) return undefined;
          return new SnsTopicPolicyPublic({ topicArn: topic.TopicArn, region, accountId: this.accountId, detectedAt: now, tags: {} });
        } catch (err) {
          logger.debug('sns-topic-policy-public: skipping topic after error', { topicArn: topic.TopicArn, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is SnsTopicPolicyPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SNS', err));
    } finally {
      client.destroy();
    }
  }
}
