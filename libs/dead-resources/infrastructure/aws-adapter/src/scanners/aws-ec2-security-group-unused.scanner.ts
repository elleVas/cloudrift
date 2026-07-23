// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  DescribeNetworkInterfacesCommand,
  type SecurityGroup,
  type NetworkInterface,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { Ec2SecurityGroupUnused, Ec2SecurityGroupUnusedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

type SecurityGroupWithId = SecurityGroup & { GroupId: string; GroupName: string };

/**
 * Detects EC2 security groups not referenced by any network interface's
 * `Groups` list. Excludes each VPC's `default` security group — AWS
 * auto-creates one and it can't be deleted, only emptied of rules, so
 * flagging it would be permanent noise.
 */
export class AwsEc2SecurityGroupUnusedScanner implements DeadResourceScannerPort {
  readonly kind = 'ec2-security-group-unused' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2SecurityGroupUnusedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const [rawGroups, enis] = await Promise.all([
        paginate<SecurityGroup>(async (cursor) => {
          const r = await client.send(new DescribeSecurityGroupsCommand({ NextToken: cursor }));
          return { items: r.SecurityGroups ?? [], cursor: r.NextToken };
        }),
        paginate<NetworkInterface>(async (cursor) => {
          const r = await client.send(new DescribeNetworkInterfacesCommand({ NextToken: cursor }));
          return { items: r.NetworkInterfaces ?? [], cursor: r.NextToken };
        }),
      ]);

      const inUseGroupIds = new Set<string>();
      for (const eni of enis) {
        for (const group of eni.Groups ?? []) {
          if (group.GroupId) inUseGroupIds.add(group.GroupId);
        }
      }

      const now = new Date();
      const validGroups = rawGroups.filter(
        (g): g is SecurityGroupWithId => !!g.GroupId && !!g.GroupName,
      );

      const results = validGroups
        .filter((g) => g.GroupName !== 'default' && !inUseGroupIds.has(g.GroupId))
        .map(
          (g) =>
            new Ec2SecurityGroupUnused({
              groupId: g.GroupId,
              groupName: g.GroupName,
              region,
              accountId: this.accountId,
              detectedAt: now,
              tags: Object.fromEntries((g.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((g) => this.policy.evaluate(g, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
