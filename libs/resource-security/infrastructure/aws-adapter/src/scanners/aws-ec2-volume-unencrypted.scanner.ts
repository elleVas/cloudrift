// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand, type Volume } from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { Ec2VolumeUnencrypted, Ec2VolumeUnencryptedPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

type VolumeWithId = Volume & { VolumeId: string };

/** Detects EBS volumes not encrypted at rest (CIS AWS Foundations 2.2.1). */
export class AwsEc2VolumeUnencryptedScanner implements ResourceSecurityScannerPort {
  readonly kind = 'ec2-volume-unencrypted' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2VolumeUnencryptedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawVolumes = await paginate<Volume>(async (cursor) => {
        const r = await client.send(new DescribeVolumesCommand({ NextToken: cursor }));
        return { items: r.Volumes ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validVolumes = rawVolumes.filter((v): v is VolumeWithId => !!v.VolumeId);

      const results = validVolumes
        .filter((v) => v.Encrypted !== true)
        .map(
          (v) =>
            new Ec2VolumeUnencrypted({
              volumeId: v.VolumeId,
              region,
              accountId: this.accountId,
              detectedAt: now,
              tags: Object.fromEntries((v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
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
