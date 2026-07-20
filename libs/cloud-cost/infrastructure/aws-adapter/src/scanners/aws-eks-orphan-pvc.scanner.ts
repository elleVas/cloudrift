// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand, type Volume } from '@aws-sdk/client-ec2';
import { EKSClient, ListClustersCommand } from '@aws-sdk/client-eks';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { EksOrphanPvc, EksOrphanPvcPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

const PVC_NAME_TAG = 'kubernetes.io/created-for/pvc/name';
const PVC_NAMESPACE_TAG = 'kubernetes.io/created-for/pvc/namespace';
// Legacy in-tree provisioner convention — the only tag that recovers the
// owning cluster's name from the volume itself (ADR-0066).
const CLUSTER_TAG_PREFIX = 'kubernetes.io/cluster/';

type VolumeWithIdAndSize = Volume & { VolumeId: string; Size: number };

function clusterNameFromTags(tags: Record<string, string>): string | undefined {
  const key = Object.keys(tags).find((k) => k.startsWith(CLUSTER_TAG_PREFIX));
  return key ? key.slice(CLUSTER_TAG_PREFIX.length) : undefined;
}

/**
 * Detects EBS volumes provisioned for an EKS PersistentVolumeClaim
 * (identified via the CSI driver's `kubernetes.io/created-for/pvc/name` tag)
 * that are either unattached, or still tagged for a cluster that no longer
 * exists. AWS-API-only (ADR-0066): `ec2:DescribeVolumes` (prefiltered on the
 * PVC tag) + `eks:ListClusters` for the cluster-existence cross-reference.
 */
export class AwsEksOrphanPvcScanner implements WasteScannerPort {
  readonly kind = 'eks-orphan-pvc' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new EksOrphanPvcPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const ec2 = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    const eks = new EKSClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const [rawVolumes, clusterNames] = await Promise.all([
        paginate<Volume>(async (cursor) => {
          const r = await ec2.send(
            new DescribeVolumesCommand({
              Filters: [{ Name: 'tag-key', Values: [PVC_NAME_TAG] }],
              NextToken: cursor,
            }),
          );
          return { items: r.Volumes ?? [], cursor: r.NextToken };
        }),
        paginate<string>(async (cursor) => {
          const r = await eks.send(new ListClustersCommand({ nextToken: cursor }));
          return { items: r.clusters ?? [], cursor: r.nextToken };
        }),
      ]);

      const existingClusters = new Set(clusterNames);
      const now = new Date();
      const validVolumes = rawVolumes.filter(
        (v): v is VolumeWithIdAndSize => !!v.VolumeId && v.Size !== undefined,
      );
      if (validVolumes.length !== rawVolumes.length) {
        logger.debug(`${this.kind}: skipped ${rawVolumes.length - validVolumes.length} entries missing VolumeId/Size`);
      }

      const volumes = validVolumes
        .map((v) => {
          const tags = Object.fromEntries((v.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
          const volumeType = v.VolumeType ?? 'gp2';
          const pricePerGb =
            this.pricing.getPrice(region, `ebs-${volumeType}`) || this.pricing.getPrice(region, 'ebs-gp3');
          const clusterName = clusterNameFromTags(tags);
          return new EksOrphanPvc({
            volumeId: v.VolumeId,
            region,
            accountId: this.accountId,
            pvcName: tags[PVC_NAME_TAG] ?? 'unknown',
            pvcNamespace: tags[PVC_NAMESPACE_TAG] ?? 'unknown',
            clusterName,
            // No cluster tag recoverable from the volume: treat existence as
            // "unknown", not "confirmed gone" (see class + entity docs).
            clusterExists: clusterName === undefined || existingClusters.has(clusterName),
            sizeGb: v.Size,
            volumeType,
            state: v.State ?? 'available',
            createdTime: v.CreateTime ?? new Date(),
            detectedAt: now,
            tags,
            monthlyCostUsd: +(pricePerGb * v.Size).toFixed(4),
          });
        })
        .filter((volume) => this.policy.evaluate(volume, now).isWaste);

      return Result.ok(volumes);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EBS', err as Error));
    } finally {
      ec2.destroy();
      eks.destroy();
    }
  }
}
