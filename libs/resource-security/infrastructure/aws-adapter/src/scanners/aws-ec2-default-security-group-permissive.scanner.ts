// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeSecurityGroupsCommand, type SecurityGroup } from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { Ec2DefaultSecurityGroupPermissive, Ec2DefaultSecurityGroupPermissivePolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const DEFAULT_GROUP_NAME = 'default';

type SecurityGroupWithId = SecurityGroup & { GroupId: string; VpcId: string };

/** Detects a VPC's auto-created `default` security group still carrying ingress/egress rules (CIS AWS Foundations 5.3). */
export class AwsEc2DefaultSecurityGroupPermissiveScanner implements ResourceSecurityScannerPort {
  readonly kind = 'ec2-default-security-group-permissive' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2DefaultSecurityGroupPermissivePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawGroups = await paginate<SecurityGroup>(async (cursor) => {
        const r = await client.send(
          new DescribeSecurityGroupsCommand({
            NextToken: cursor,
            Filters: [{ Name: 'group-name', Values: [DEFAULT_GROUP_NAME] }],
          }),
        );
        return { items: r.SecurityGroups ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validGroups = rawGroups.filter((g): g is SecurityGroupWithId => !!g.GroupId && !!g.VpcId);

      const results = validGroups
        .map(
          (g) =>
            new Ec2DefaultSecurityGroupPermissive({
              groupId: g.GroupId,
              vpcId: g.VpcId,
              region,
              accountId: this.accountId,
              hasIngressRules: (g.IpPermissions ?? []).length > 0,
              hasEgressRules: (g.IpPermissionsEgress ?? []).length > 0,
              detectedAt: now,
              tags: Object.fromEntries((g.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((g) => g.hasIngressRules || g.hasEgressRules)
        .filter((finding) => this.policy.evaluate(finding, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
