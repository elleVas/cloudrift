// SPDX-License-Identifier: Apache-2.0
import { RDSClient, DescribeDBInstancesCommand, type DBInstance } from '@aws-sdk/client-rds';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { RdsInstancePubliclyAccessible, RdsInstancePubliclyAccessiblePolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

type DbInstanceWithId = DBInstance & { DBInstanceIdentifier: string };

/** Detects RDS instances reachable from outside their VPC (CIS AWS Foundations 2.3.3). */
export class AwsRdsInstancePubliclyAccessibleScanner implements ResourceSecurityScannerPort {
  readonly kind = 'rds-instance-publicly-accessible' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new RdsInstancePubliclyAccessiblePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new RDSClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawInstances = await paginate<DBInstance>(async (cursor) => {
        const r = await client.send(new DescribeDBInstancesCommand({ Marker: cursor }));
        return { items: r.DBInstances ?? [], cursor: r.Marker };
      });

      const now = new Date();
      const validInstances = rawInstances.filter((i): i is DbInstanceWithId => !!i.DBInstanceIdentifier);

      const results = validInstances
        .filter((i) => i.PubliclyAccessible === true)
        .map(
          (i) =>
            new RdsInstancePubliclyAccessible({
              dbInstanceIdentifier: i.DBInstanceIdentifier,
              region,
              accountId: this.accountId,
              detectedAt: now,
              tags: Object.fromEntries((i.TagList ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((finding) => this.policy.evaluate(finding, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('RDS', err as Error));
    } finally {
      client.destroy();
    }
  }
}
