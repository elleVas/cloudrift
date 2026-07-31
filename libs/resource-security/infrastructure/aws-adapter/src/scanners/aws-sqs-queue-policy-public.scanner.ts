// SPDX-License-Identifier: Apache-2.0
import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { SqsQueuePolicyPublic, SqsQueuePolicyPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig, parsePolicyStatements, isWildcardPrincipal } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-queue `GetQueueAttributes` calls in flight at once. */
const QUEUE_CHECK_CONCURRENCY = 8;

function isPublicPolicy(policyJson: string | undefined): boolean {
  return parsePolicyStatements(policyJson).some((s) => s.Effect === 'Allow' && isWildcardPrincipal(s.Principal) && s.Condition === undefined);
}

/** Detects SQS queues with an access policy granting access to any AWS principal, with no restricting condition. */
export class AwsSqsQueuePolicyPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 'sqs-queue-policy-public' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new SqsQueuePolicyPublicPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new SQSClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const queueUrls = await paginate<string>(async (cursor) => {
        const r = await client.send(new ListQueuesCommand({ NextToken: cursor }));
        return { items: r.QueueUrls ?? [], cursor: r.NextToken };
      });
      const now = new Date();

      const candidates = await mapWithConcurrency(queueUrls, QUEUE_CHECK_CONCURRENCY, async (queueUrl) => {
        try {
          const { Attributes } = await client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['Policy'] }));
          if (!isPublicPolicy(Attributes?.Policy)) return undefined;
          return new SqsQueuePolicyPublic({ queueUrl, region, accountId: this.accountId, detectedAt: now, tags: {} });
        } catch (err) {
          logger.debug('sqs-queue-policy-public: skipping queue after error', { queueUrl, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is SqsQueuePolicyPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SQS', err));
    } finally {
      client.destroy();
    }
  }
}
