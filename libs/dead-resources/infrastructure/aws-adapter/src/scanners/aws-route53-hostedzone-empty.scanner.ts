// SPDX-License-Identifier: Apache-2.0
import { Route53Client, ListHostedZonesCommand, type HostedZone } from '@aws-sdk/client-route-53';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { Route53HostedZoneEmpty, Route53HostedZoneEmptyPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

/** Route53 has a single global endpoint — always sign against this region, never the one `scan()` receives (ADR-0078). */
const ROUTE53_ENDPOINT_REGION = 'us-east-1';

/** Every hosted zone always has exactly these 2 default records (NS + SOA) — anything at or below this count has no real DNS data. */
const DEFAULT_RECORD_COUNT = 2;

type HostedZoneWithId = HostedZone & { Id: string; Name: string; ResourceRecordSetCount: number };

/**
 * Detects Route53 hosted zones with no records beyond the default NS/SOA
 * pair. `ResourceRecordSetCount` is returned inline by `ListHostedZones` —
 * no per-zone `ListResourceRecordSets` call needed. `scope: 'global'` —
 * Route53 has no per-region data, see `DeadResourceScannerPort` and
 * ADR-0078.
 */
export class AwsRoute53HostedZoneEmptyScanner implements DeadResourceScannerPort {
  readonly kind = 'route53-hostedzone-empty' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new Route53HostedZoneEmptyPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new Route53Client({ ...createAwsClientConfig(), region: ROUTE53_ENDPOINT_REGION });
    try {
      const rawZones = await paginate<HostedZone>(async (cursor) => {
        const r = await client.send(new ListHostedZonesCommand({ Marker: cursor }));
        return { items: r.HostedZones ?? [], cursor: r.IsTruncated ? r.NextMarker : undefined };
      });

      const now = new Date();
      const validZones = rawZones.filter(
        (z): z is HostedZoneWithId => !!z.Id && !!z.Name && z.ResourceRecordSetCount !== undefined,
      );

      const results = validZones
        .filter((z) => z.ResourceRecordSetCount <= DEFAULT_RECORD_COUNT)
        .map(
          (z) =>
            new Route53HostedZoneEmpty({
              hostedZoneId: z.Id.replace('/hostedzone/', ''),
              name: z.Name,
              accountId: this.accountId,
              detectedAt: now,
              tags: {},
            }),
        )
        .filter((z) => this.policy.evaluate(z, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('Route53', err as Error));
    } finally {
      client.destroy();
    }
  }
}
