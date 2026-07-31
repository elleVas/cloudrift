// SPDX-License-Identifier: Apache-2.0
import { RedshiftClient, DescribeClustersCommand, type Cluster } from '@aws-sdk/client-redshift';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { RedshiftClusterPubliclyAccessible, RedshiftClusterPubliclyAccessiblePolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, createAwsClientConfig } from 'shared-aws-infra-utils';

type ClusterWithId = Cluster & { ClusterIdentifier: string };

/** Detects Redshift clusters reachable from the internet (`PubliclyAccessible: true`) — the Redshift analog of `rds-instance-publicly-accessible`. */
export class AwsRedshiftClusterPubliclyAccessibleScanner implements ResourceSecurityScannerPort {
  readonly kind = 'redshift-cluster-publicly-accessible' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new RedshiftClusterPubliclyAccessiblePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new RedshiftClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawClusters = await paginate<Cluster>(async (cursor) => {
        const r = await client.send(new DescribeClustersCommand({ Marker: cursor }));
        return { items: r.Clusters ?? [], cursor: r.Marker };
      });

      const now = new Date();
      const validClusters = rawClusters.filter((c): c is ClusterWithId => !!c.ClusterIdentifier);

      const results = validClusters
        .filter((c) => c.PubliclyAccessible === true)
        .map(
          (c) =>
            new RedshiftClusterPubliclyAccessible({
              clusterId: c.ClusterIdentifier,
              region,
              accountId: this.accountId,
              detectedAt: now,
              tags: Object.fromEntries((c.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((finding) => this.policy.evaluate(finding, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Redshift', err));
    } finally {
      client.destroy();
    }
  }
}
