// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeSnapshotsCommand, DescribeSnapshotAttributeCommand, type Snapshot } from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { Ec2SnapshotPublic, Ec2SnapshotPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

/** Per-snapshot `DescribeSnapshotAttribute` calls in flight at once. */
const SNAPSHOT_CHECK_CONCURRENCY = 8;
const PUBLIC_GROUP = 'all';

type SnapshotWithId = Snapshot & { SnapshotId: string };

/** Detects EBS snapshots with `createVolumePermission` granted to the `all` group. */
export class AwsEc2SnapshotPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 'ec2-snapshot-public' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2SnapshotPublicPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawSnapshots = await paginate<Snapshot>(async (cursor) => {
        const r = await client.send(new DescribeSnapshotsCommand({ OwnerIds: ['self'], NextToken: cursor }));
        return { items: r.Snapshots ?? [], cursor: r.NextToken };
      });
      const validSnapshots = rawSnapshots.filter((s): s is SnapshotWithId => !!s.SnapshotId);
      const now = new Date();

      const candidates = await mapWithConcurrency(validSnapshots, SNAPSHOT_CHECK_CONCURRENCY, async (snapshot) => {
        const { CreateVolumePermissions } = await client.send(
          new DescribeSnapshotAttributeCommand({ SnapshotId: snapshot.SnapshotId, Attribute: 'createVolumePermission' }),
        );
        const isPublic = (CreateVolumePermissions ?? []).some((p) => p.Group === PUBLIC_GROUP);
        if (!isPublic) return undefined;
        return new Ec2SnapshotPublic({
          snapshotId: snapshot.SnapshotId,
          volumeId: snapshot.VolumeId ?? 'unknown',
          region,
          accountId: this.accountId,
          detectedAt: now,
          tags: Object.fromEntries((snapshot.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
        });
      });

      const results = candidates
        .filter((c): c is Ec2SnapshotPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
