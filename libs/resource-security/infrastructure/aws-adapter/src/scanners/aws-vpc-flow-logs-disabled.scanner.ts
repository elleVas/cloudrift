// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVpcsCommand, DescribeFlowLogsCommand, type Vpc } from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { VpcFlowLogsDisabled, VpcFlowLogsDisabledPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, createAwsClientConfig } from 'shared-aws-infra-utils';

type VpcWithId = Vpc & { VpcId: string };

/** Detects VPCs with no active Flow Log (CIS AWS Foundations 3.9). */
export class AwsVpcFlowLogsDisabledScanner implements ResourceSecurityScannerPort {
  readonly kind = 'vpc-flow-logs-disabled' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new VpcFlowLogsDisabledPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawVpcs = await paginate<Vpc>(async (cursor) => {
        const r = await client.send(new DescribeVpcsCommand({ NextToken: cursor }));
        return { items: r.Vpcs ?? [], cursor: r.NextToken };
      });
      const validVpcs = rawVpcs.filter((v): v is VpcWithId => !!v.VpcId);

      const flowLogs = await paginate(async (cursor) => {
        const r = await client.send(new DescribeFlowLogsCommand({ NextToken: cursor }));
        return { items: r.FlowLogs ?? [], cursor: r.NextToken };
      });
      const activelyLoggedVpcIds = new Set(
        flowLogs.filter((f) => f.FlowLogStatus === 'ACTIVE' && f.ResourceId).map((f) => f.ResourceId as string),
      );

      const now = new Date();
      const results = validVpcs
        .filter((v) => !activelyLoggedVpcIds.has(v.VpcId))
        .map(
          (v) =>
            new VpcFlowLogsDisabled({
              vpcId: v.VpcId,
              region,
              accountId: this.accountId,
              detectedAt: now,
              tags: Object.fromEntries((v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((finding) => this.policy.evaluate(finding, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err));
    } finally {
      client.destroy();
    }
  }
}
