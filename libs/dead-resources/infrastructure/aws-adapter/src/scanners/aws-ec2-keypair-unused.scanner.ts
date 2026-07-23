// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeKeyPairsCommand,
  DescribeInstancesCommand,
  type KeyPairInfo,
  type Instance,
  type Reservation,
} from '@aws-sdk/client-ec2';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { Ec2KeyPairUnused, Ec2KeyPairUnusedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type KeyPairWithId = KeyPairInfo & { KeyPairId: string; KeyName: string };

/**
 * Detects EC2 key pairs not referenced by any instance's `KeyName` (running
 * or stopped — a terminated instance's key reference no longer matters for
 * future launches, same "terminated doesn't count" rule `AwsAmiUnusedScanner`
 * applies to AMIs). `DescribeKeyPairsCommand` doesn't paginate (AWS returns
 * every key pair for the region in one call), unlike `DescribeInstancesCommand`.
 */
export class AwsEc2KeyPairUnusedScanner implements DeadResourceScannerPort {
  readonly kind = 'ec2-keypair-unused' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2KeyPairUnusedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const [keyPairsResponse, instances] = await Promise.all([
        client.send(new DescribeKeyPairsCommand({})),
        paginate<Reservation, Instance>(
          async (cursor) => {
            const r = await client.send(new DescribeInstancesCommand({ NextToken: cursor }));
            return { items: r.Reservations ?? [], cursor: r.NextToken };
          },
          (reservations) => reservations.flatMap((r) => r.Instances ?? []),
        ),
      ]);

      const inUseKeyNames = new Set<string>();
      for (const instance of instances) {
        if (instance.State?.Name !== 'terminated' && instance.KeyName) {
          inUseKeyNames.add(instance.KeyName);
        }
      }

      const now = new Date();
      const rawKeyPairs = keyPairsResponse.KeyPairs ?? [];
      const validKeyPairs = rawKeyPairs.filter(
        (kp): kp is KeyPairWithId => !!kp.KeyPairId && !!kp.KeyName,
      );
      if (validKeyPairs.length !== rawKeyPairs.length) {
        logger.debug(`${this.kind}: skipped ${rawKeyPairs.length - validKeyPairs.length} entries missing KeyPairId/KeyName`);
      }

      const results = validKeyPairs
        .filter((kp) => !inUseKeyNames.has(kp.KeyName))
        .map(
          (kp) =>
            new Ec2KeyPairUnused({
              keyPairId: kp.KeyPairId,
              keyName: kp.KeyName,
              region,
              accountId: this.accountId,
              createdAt: kp.CreateTime ?? new Date(0),
              detectedAt: now,
              tags: Object.fromEntries((kp.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((keyPair) => this.policy.evaluate(keyPair, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
