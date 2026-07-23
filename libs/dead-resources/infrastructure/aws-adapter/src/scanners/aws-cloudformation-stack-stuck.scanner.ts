// SPDX-License-Identifier: Apache-2.0
import { CloudFormationClient, DescribeStacksCommand, type Stack } from '@aws-sdk/client-cloudformation';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { CloudformationStackStuck, CloudformationStackStuckPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

/** Permanent failure states a stack can't recover from without manual intervention. */
const STUCK_STATUSES = new Set(['CREATE_FAILED', 'ROLLBACK_FAILED', 'DELETE_FAILED', 'UPDATE_ROLLBACK_FAILED']);

type StackWithId = Stack & { StackId: string; StackName: string; StackStatus: string; CreationTime: Date };

/**
 * Detects CloudFormation stacks stuck in a permanent failure state. Uses
 * `DescribeStacksCommand` rather than `ListStacksCommand` (which would let
 * the filtering happen server-side via `StackStatusFilter`) specifically to
 * get `Tags` inline — `ListStacks`'s `StackSummary` doesn't include them.
 */
export class AwsCloudformationStackStuckScanner implements DeadResourceScannerPort {
  readonly kind = 'cloudformation-stack-stuck' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new CloudformationStackStuckPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new CloudFormationClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawStacks = await paginate<Stack>(async (cursor) => {
        const r = await client.send(new DescribeStacksCommand({ NextToken: cursor }));
        return { items: r.Stacks ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validStacks = rawStacks.filter(
        (s): s is StackWithId => !!s.StackId && !!s.StackName && !!s.StackStatus && !!s.CreationTime,
      );

      const results = validStacks
        .filter((s) => STUCK_STATUSES.has(s.StackStatus))
        .map(
          (s) =>
            new CloudformationStackStuck({
              stackId: s.StackId,
              stackName: s.StackName,
              status: s.StackStatus,
              region,
              accountId: this.accountId,
              createdAt: s.CreationTime,
              detectedAt: now,
              tags: Object.fromEntries((s.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((s) => this.policy.evaluate(s, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudFormation', err as Error));
    } finally {
      client.destroy();
    }
  }
}
