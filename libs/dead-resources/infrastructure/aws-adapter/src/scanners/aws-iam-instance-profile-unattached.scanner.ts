// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListInstanceProfilesCommand, type InstanceProfile } from '@aws-sdk/client-iam';
import { EC2Client, DescribeRegionsCommand, DescribeInstancesCommand, type Reservation, type Instance } from '@aws-sdk/client-ec2';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { IamInstanceProfileUnattached, IamInstanceProfileUnattachedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

/** IAM has a single global endpoint — always sign against this region, never the one `scan()` receives (ADR-0078). */
const IAM_ENDPOINT_REGION = 'us-east-1';

/**
 * Bounds the per-region DescribeInstances fan-out below. Lower than the
 * usual `5` used elsewhere in this domain (2026-07-23): unlike other
 * fan-outs (which repeat calls against one already-connected client/host),
 * every item here is a fresh DNS+TCP+TLS handshake to a *different* AWS
 * regional endpoint — 3 at once, not 5, keeps that burst smaller on a
 * consumer network (see `createAwsClientConfig`'s `connectionTimeout`
 * comment for the connection-timeout failures this and the timeout bump
 * were both a response to).
 */
const REGION_SCAN_CONCURRENCY = 3;

type InstanceProfileWithId = InstanceProfile & { InstanceProfileId: string; InstanceProfileName: string; Arn: string; CreateDate: Date };

/**
 * Detects IAM instance profiles not referenced by any EC2 instance's
 * `IamInstanceProfile.Arn` — checked **account-wide, across every enabled
 * AWS region**, not just the region(s) the rest of the scan was asked
 * about. An instance profile is a global IAM object: it can be attached to
 * an instance in any region, so cross-referencing it against only the
 * requested `--regions` would risk false positives (a profile in real use
 * two regions over would look "unattached" from here). This scanner
 * deliberately ignores the `--regions` flag's scope for that reason —
 * `DescribeRegionsCommand` enumerates every enabled region itself.
 * `scope: 'global'` — IAM has no per-region data, see
 * `DeadResourceScannerPort` and ADR-0078.
 */
export class AwsIamInstanceProfileUnattachedScanner implements DeadResourceScannerPort {
  readonly kind = 'iam-instance-profile-unattached' as const;
  readonly scope = 'global' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new IamInstanceProfileUnattachedPolicy(),
  ) {}

  async scan(_region: AwsRegion): Promise<Result<DeadResource[]>> {
    const iamClient = new IAMClient({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    const regionDiscoveryClient = new EC2Client({ ...createAwsClientConfig(), region: IAM_ENDPOINT_REGION });
    try {
      const [rawProfiles, regionsResponse] = await Promise.all([
        paginate<InstanceProfile>(async (cursor) => {
          const r = await iamClient.send(new ListInstanceProfilesCommand({ Marker: cursor }));
          return { items: r.InstanceProfiles ?? [], cursor: r.Marker };
        }),
        regionDiscoveryClient.send(new DescribeRegionsCommand({ AllRegions: false })),
      ]);

      const enabledRegionCodes = (regionsResponse.Regions ?? []).map((r) => r.RegionName).filter((r): r is string => !!r);

      const inUseArns = new Set<string>();
      await mapWithConcurrency(enabledRegionCodes, REGION_SCAN_CONCURRENCY, async (regionCode) => {
        const client = new EC2Client({ ...createAwsClientConfig(), region: regionCode });
        try {
          const instances = await paginate<Reservation, Instance>(
            async (cursor) => {
              const r = await client.send(new DescribeInstancesCommand({ NextToken: cursor }));
              return { items: r.Reservations ?? [], cursor: r.NextToken };
            },
            (reservations) => reservations.flatMap((r) => r.Instances ?? []),
          );
          for (const instance of instances) {
            if (instance.State?.Name !== 'terminated' && instance.IamInstanceProfile?.Arn) {
              inUseArns.add(instance.IamInstanceProfile.Arn);
            }
          }
        } catch (err) {
          // A single unreachable/opted-out region shouldn't fail the whole account-wide check.
          logger.debug(`iam-instance-profile-unattached: skipped region ${regionCode}`, { error: (err as Error).message });
        } finally {
          client.destroy();
        }
      });

      const now = new Date();
      const validProfiles = rawProfiles.filter(
        (p): p is InstanceProfileWithId => !!p.InstanceProfileId && !!p.InstanceProfileName && !!p.Arn && !!p.CreateDate,
      );

      const results = validProfiles
        .filter((p) => !inUseArns.has(p.Arn))
        .map(
          (p) =>
            new IamInstanceProfileUnattached({
              instanceProfileId: p.InstanceProfileId,
              instanceProfileName: p.InstanceProfileName,
              arn: p.Arn,
              accountId: this.accountId,
              createdAt: p.CreateDate,
              detectedAt: now,
              tags: Object.fromEntries((p.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
            }),
        )
        .filter((p) => this.policy.evaluate(p, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('IAM', err as Error));
    } finally {
      iamClient.destroy();
      regionDiscoveryClient.destroy();
    }
  }
}
