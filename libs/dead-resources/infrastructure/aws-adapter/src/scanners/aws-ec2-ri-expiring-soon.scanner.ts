// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeReservedInstancesCommand, type ReservedInstances } from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { Ec2RiExpiringSoon, Ec2RiExpiringSoonPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

type ReservedInstancesWithId = ReservedInstances & {
  ReservedInstancesId: string;
  InstanceType: string;
  End: Date;
};

/**
 * Detects active EC2 Reserved Instances whose term ends soon. Unlike the
 * other scanners in this domain, this is regional the same way the RI
 * itself is regional/AZ-scoped — no global-scope wrinkle here.
 * `DescribeReservedInstancesCommand` doesn't paginate (AWS returns every RI
 * for the region in one call), same as `DescribeKeyPairsCommand`.
 */
export class AwsEc2RiExpiringSoonScanner implements DeadResourceScannerPort {
  readonly kind = 'ec2-ri-expiring-soon' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2RiExpiringSoonPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const response = await client.send(
        new DescribeReservedInstancesCommand({ Filters: [{ Name: 'state', Values: ['active'] }] }),
      );

      const now = new Date();
      const raw = response.ReservedInstances ?? [];
      const validRis = raw.filter(
        (ri): ri is ReservedInstancesWithId => !!ri.ReservedInstancesId && !!ri.InstanceType && !!ri.End,
      );

      const results = validRis
        .map(
          (ri) =>
            new Ec2RiExpiringSoon({
              reservedInstancesId: ri.ReservedInstancesId,
              region,
              accountId: this.accountId,
              instanceType: ri.InstanceType,
              instanceCount: ri.InstanceCount ?? 1,
              end: ri.End,
              detectedAt: now,
              tags: Object.fromEntries((ri.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((ri) => this.policy.evaluate(ri, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
