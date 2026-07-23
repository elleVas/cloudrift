// SPDX-License-Identifier: Apache-2.0
import { CloudTrailClient, DescribeTrailsCommand } from '@aws-sdk/client-cloudtrail';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { CloudtrailNotMultiregion, CloudtrailNotMultiregionPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

/** CloudTrail's `DescribeTrails` (with `includeShadowTrails`) needs one home-region endpoint to see every trail account-wide. */
const CLOUDTRAIL_ENDPOINT_REGION = 'us-east-1';

/** Detects accounts with no CloudTrail trail configured for multi-region logging (CIS AWS Foundations 3.1). `scope: 'global'`. */
export class AwsCloudtrailNotMultiregionScanner implements ResourceSecurityScannerPort {
  readonly kind = 'cloudtrail-not-multiregion' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new CloudtrailNotMultiregionPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new CloudTrailClient({ ...createAwsClientConfig(), region: CLOUDTRAIL_ENDPOINT_REGION });
    try {
      const { trailList } = await client.send(new DescribeTrailsCommand({ includeShadowTrails: true }));
      const now = new Date();
      const finding = new CloudtrailNotMultiregion({
        accountId: this.accountId,
        hasMultiRegionTrail: (trailList ?? []).some((t) => t.IsMultiRegionTrail === true),
        detectedAt: now,
        tags: {},
      });

      return Result.ok(this.policy.evaluate(finding, now).flagged ? [finding] : []);
    } catch (err) {
      return Result.fail(new AwsAdapterError('CloudTrail', err as Error));
    } finally {
      client.destroy();
    }
  }
}
