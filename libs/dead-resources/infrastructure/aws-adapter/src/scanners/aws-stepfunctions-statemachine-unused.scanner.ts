// SPDX-License-Identifier: Apache-2.0
import { SFNClient, ListStateMachinesCommand, ListExecutionsCommand, type StateMachineListItem } from '@aws-sdk/client-sfn';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { StepfunctionsStatemachineUnused, StepfunctionsStatemachineUnusedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

/** Bounds the per-state-machine ListExecutions fan-out, same reasoning/value as `iam-user-inactive`'s fan-out. */
const EXECUTION_LOOKUP_CONCURRENCY = 5;

type StateMachineWithId = StateMachineListItem & { stateMachineArn: string; name: string; creationDate: Date };

/**
 * Detects STANDARD-type Step Functions state machines with zero executions
 * ever. EXPRESS-type machines are excluded: `ListExecutions` doesn't cover
 * them (their history lives only in CloudWatch Logs), so "never executed"
 * can't be verified the same way — same "prove the pattern, defer the rest"
 * reasoning as `AwsEventbridgeRuleNoTargetsScanner`'s default-bus-only scope.
 * `ListStateMachines` doesn't return tags inline, so `tags` is always `{}`.
 */
export class AwsStepfunctionsStatemachineUnusedScanner implements DeadResourceScannerPort {
  readonly kind = 'stepfunctions-statemachine-unused' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new StepfunctionsStatemachineUnusedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new SFNClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawMachines = await paginate<StateMachineListItem>(async (cursor) => {
        const r = await client.send(new ListStateMachinesCommand({ nextToken: cursor }));
        return { items: r.stateMachines ?? [], cursor: r.nextToken };
      });
      const standardMachines = rawMachines.filter(
        (m): m is StateMachineWithId => !!m.stateMachineArn && !!m.name && !!m.creationDate && m.type === 'STANDARD',
      );

      const now = new Date();
      const candidates = await mapWithConcurrency(standardMachines, EXECUTION_LOOKUP_CONCURRENCY, async (machine) => {
        const r = await client.send(new ListExecutionsCommand({ stateMachineArn: machine.stateMachineArn, maxResults: 1 }));
        if ((r.executions ?? []).length > 0) return undefined;
        return new StepfunctionsStatemachineUnused({
          stateMachineArn: machine.stateMachineArn,
          name: machine.name,
          region,
          accountId: this.accountId,
          createdAt: machine.creationDate,
          detectedAt: now,
          tags: {},
        });
      });

      const results = candidates
        .filter((m): m is StepfunctionsStatemachineUnused => m !== undefined)
        .filter((m) => this.policy.evaluate(m, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SFN', err as Error));
    } finally {
      client.destroy();
    }
  }
}
