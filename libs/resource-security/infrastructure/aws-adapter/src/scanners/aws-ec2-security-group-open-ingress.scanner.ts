// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeSecurityGroupsCommand, type SecurityGroup, type IpPermission } from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { Ec2SecurityGroupOpenIngress, Ec2SecurityGroupOpenIngressPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const OPEN_IPV4 = '0.0.0.0/0';
const OPEN_IPV6 = '::/0';

/** Commonly-attacked ports worth calling out by name: remote administration and default database ports. */
const SENSITIVE_PORTS: ReadonlyArray<{ port: number; label: string }> = [
  { port: 22, label: 'SSH' },
  { port: 3389, label: 'RDP' },
  { port: 3306, label: 'MySQL' },
  { port: 5432, label: 'PostgreSQL' },
  { port: 1433, label: 'MSSQL' },
  { port: 27017, label: 'MongoDB' },
  { port: 6379, label: 'Redis' },
];

type SecurityGroupWithId = SecurityGroup & { GroupId: string; GroupName: string };

function portInRange(port: number, permission: IpPermission): boolean {
  if (permission.IpProtocol === '-1') return true; // all ports
  const from = permission.FromPort ?? -1;
  const to = permission.ToPort ?? -1;
  return port >= from && port <= to;
}

function matchedRulesFor(group: SecurityGroup): string[] {
  const matches: string[] = [];
  for (const permission of group.IpPermissions ?? []) {
    const openToInternet =
      (permission.IpRanges ?? []).some((r) => r.CidrIp === OPEN_IPV4) ||
      (permission.Ipv6Ranges ?? []).some((r) => r.CidrIpv6 === OPEN_IPV6);
    if (!openToInternet) continue;
    for (const { port, label } of SENSITIVE_PORTS) {
      if (portInRange(port, permission)) matches.push(`${port}/${label} from 0.0.0.0/0`);
    }
  }
  return [...new Set(matches)];
}

/** Detects EC2 security groups with an ingress rule open to the internet on a commonly-attacked port. */
export class AwsEc2SecurityGroupOpenIngressScanner implements ResourceSecurityScannerPort {
  readonly kind = 'ec2-security-group-open-ingress' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2SecurityGroupOpenIngressPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawGroups = await paginate<SecurityGroup>(async (cursor) => {
        const r = await client.send(new DescribeSecurityGroupsCommand({ NextToken: cursor }));
        return { items: r.SecurityGroups ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validGroups = rawGroups.filter((g): g is SecurityGroupWithId => !!g.GroupId && !!g.GroupName);

      const results = validGroups
        .map((g) => ({ group: g, matchedRules: matchedRulesFor(g) }))
        .filter(({ matchedRules }) => matchedRules.length > 0)
        .map(
          ({ group, matchedRules }) =>
            new Ec2SecurityGroupOpenIngress({
              groupId: group.GroupId,
              groupName: group.GroupName,
              region,
              accountId: this.accountId,
              matchedRules,
              detectedAt: now,
              tags: Object.fromEntries((group.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((finding) => this.policy.evaluate(finding, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
